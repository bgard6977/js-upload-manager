/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
/**
 * A resilient upload manager that keeps files in local storage until uploads can be completed
 */
define([
        'real/FileReader',
        'real/localStorage',
        'real/XMLHttpRequest',
        'real/Timer',
        'events/EventDispatcher',
        'events/ProgressEvent',
        'filters/DefaultFilter',
        'uploads/BandwidthTracker',
        'uploads/UploadState'
    ],
    function defineUploadManager(
        FileReader,
        localStorage,
        XMLHttpRequest,
        Timer,
        EventDispatcher,
        ProgressEvent,
        DefaultFilter,
        BandwidthTracker,
        UploadState
    ) {

        var UploadManager = function (path) {

            var self = new EventDispatcher();

            // Upload constants
            var CHUNK_SIZE = 20 * 1024;     // Set as needed according to bandwidth & latency
            var POLL_INTERVAL = 10;         // Set as needed according to bandwidth & latency
            var ERROR_INTERVAL = 3000;      // Don't DoS the server if we start encountering errors
            var METHOD = 'PUT';
            var CONTENT_RANGE = 'Content-Range';

            // TODO: Move to utility class
            var INTEGER = {
                'MAX_VALUE': Math.pow(2, 32)
            };

            var timer = null;
            var filters = [new DefaultFilter()];
            var tracker = new BandwidthTracker();

            // -------------------------------------------- Public API ----------------------------------------------------

            self.setPath = function (val) {
                path = val;
            };

            self.getPath = function () {
                return path;
            };

            /**
             * Puts a file in the upload queue
             * @param file The file to enqueue
             */
            self.enqueue = function (file) {
                // Save meta data
                var state = new UploadState(nextKey());
                state.setFilename(file.name);
                state.setMimeType(file.type);
                state.setPosition(0);
                state.save();

                // Read the file from the disk
                var reader = new FileReader();
                reader.onload = function (ev) {
                    var data = ev.target.result;

                    var ar = filters.slice(0);
                    var callback = function (data) {
                        if (ar.length > 0) {
                            var f2 = ar.pop();
                            f2.onLoad(data, callback);
                        } else {
                            state.setData(data);
                            state.save();
                        }
                    };
                    var f1 = ar.pop();
                    f1.onLoad(data, callback);
                };
                reader.readAsArrayBuffer(file);
            };

            /**
             * Starts uploading the file queue to the server
             */
            self.upload = function () {
                if (timer !== null) {
                    return; // Already running
                }
                timer = Timer.setInterval(poll, POLL_INTERVAL);
            };

            /**
             * Stops any uploads in progress
             */
            self.stop = function () {
                Timer.clearInterval(timer);
                timer = null;
            };

            /**
             * Removes all pending uploads from local storage
             */
            self.clear = function () {
                for (var key in localStorage) {
                    if (!localStorage.hasOwnProperty(key)) {
                        continue;
                    }
                    if (isInt(key)) {
                        localStorage.removeItem(key);
                    }
                }
            };

            /**
             * Adds an upload processing filter to the chain
             * @param filter The filter to add
             */
            self.addFilter = function (filter) {
                if (filters.indexOf(filter) >= 0) {
                    return;
                }
                filters.push(filter);
            };

            self.getKbps = function () {
                return tracker.getKbps();
            };

            // ------------------------------------------------ Private methods -------------------------------------------

            // TODO: Move to utility class
            var isInt = function (value) {
                if (isNaN(value)) {
                    return false;
                }
                return value == parseInt(value);
            };

            /**
             * @returns {number} The key of the next file to upload
             */
            var minKey = function () {
                var min = INTEGER.MAX_VALUE;
                for (var key in localStorage) {
                    if (!localStorage.hasOwnProperty(key)) {
                        continue;
                    }
                    if (!isInt(key)) {
                        continue;
                    }
                    min = Math.min(min, parseInt(key));
                }
                if (min === INTEGER.MAX_VALUE) {
                    return 0;
                }
                return min;
            };

            /**
             * @returns {number} The key of the current upload, or 0
             */
            var activeKey = function () {
                var max = 0;
                for (var key in localStorage) {
                    if (!localStorage.hasOwnProperty(key)) {
                        continue;
                    }
                    max = Math.max(max, parseInt(key));
                }
                return max;
            };

            /**
             * @returns {number} The key where the next upload should be stored
             */
            var nextKey = function () {
                return activeKey() + 1;
            };

            /**
             * @returns {UploadState|null} The current thing to upload, or null
             */
            var getCurrentUploadState = function () {
                // See if there are things to upload
                var mk = minKey();
                if (mk === 0) {
                    return null;
                }

                // Grab the next thing to upload
                var state = new UploadState(mk);
                state.load();
                if (state.getLength() === 0) {
                    return null; // File data not yet loaded
                }

                return state;
            };

            /**
             * @param state The upload state
             * @returns {number} The index+1 of the last byte to send
             */
            var getNextEnd = function (state) {
                var nextPos = state.getPosition() + CHUNK_SIZE;
                return Math.min(nextPos, state.getLength());
            };

            /**
             * @param state The upload state
             * @returns {number} The size of the next chunk to upload
             */
            var getNextChunkSize = function (state) {
                var end = getNextEnd(state);
                return end - state.getPosition();
            };

            var completeUpload = function (state) {
                state.free();
                updateStatus();
                self.dispatch(new ProgressEvent(null));
            };

            /**
             * Called periodically to check for work, and advance if possible
             */
            var poll = function () {
                //console.log('poll() Polling for work...');
                if (tracker.isUploading()) {
                    return; // Don't be re-entrant
                }

                // Get the current upload state
                var state = getCurrentUploadState();
                if (state === null) {
                    //console.log('poll() No uploads left!');
                    return; // Nothing to upload, or data still being loaded from disk
                }

                // Grab the next chunk to upload
                var chunk = getNextChunk(state);
                if (chunk === null) {
                    console.log('poll() Upload in queue, but still waiting for data to load from disk...');
                    completeUpload(state);
                    return;
                }

                // Upload it!
                sendNextChunk(state);
            };

            /**
             * @param state The upload state
             * @returns {Uint8Array|null} The next chunk to upload, or null
             */
            var getNextChunk = function (state) {
                var chunkSize = getNextChunkSize(state);
                if (chunkSize <= 0) {
                    return null;
                }
                return new Uint8Array(state.getData(), state.getPosition(), chunkSize);
            };

            var sendNextChunk = function (state) {
                var abv = getNextChunk(state);
                //console.log('sendNextChunk() sending ' + abv.length + ' bytes..');
                var req = createNextRequest(state);
                tracker.startUpload(abv.length);
                req.send(abv);
            };

            var buildContentRange = function (state) {
                var end = getNextEnd(state);

                var text = 'bytes ';
                text += state.getPosition();
                text += '-';
                text += (end - 1);
                text += '/';
                text += state.getLength();

                return text;
            };

            var createNextRequest = function (state) {

                var url = path + '/' + state.getFilename();

                var req = new XMLHttpRequest();
                req.addEventListener('progress', updateProgress, false);
                req.addEventListener('load', transferComplete, false);
                req.addEventListener('error', transferFailed, false);
                req.addEventListener('abort', transferCanceled, false);
                req.open(METHOD, url, true);

                var contentRange = buildContentRange(state);
                req.setRequestHeader(CONTENT_RANGE, contentRange);
                req.overrideMimeType(state.getMimeType());

                console.log('createNextRequest() ' + state.getFilename() + ' ' + contentRange);

                return req;
            };

            var freeRequest = function (ev) {
                var req = ev.target;
                req.removeEventListener('progress', updateProgress);
                req.removeEventListener('load', transferComplete);
                req.removeEventListener('error', transferFailed);
                req.removeEventListener('abort', transferCanceled);
                tracker.endUpload();
            };

            // -------------------------------------------- Status events -------------------------------------------------
            var updateProgress = function (ev) {
                // TODO: Fire onProgress?
            };

            var transferComplete = function (ev) {
                //console.log('transferComplete()')

                // Lookup state
                var state = getCurrentUploadState();
                if (state == null) {
                    console.log("Upload completed, but no corresponding state found!");
                    return; // Not sure how to handle this error - someone cleared their local storage during upload maybe?
                }

                // Handle response
                var req = ev.target;
                if (req.readyState < 4) {
                    return; // Not complete yet - invalid state
                }

                // Happy path
                if (req.status >= 200 && req.status < 300) {
                    state.setPosition(state.getPosition() + CHUNK_SIZE);
                    state.save();
                } else {
                    if (timer) {
                        Timer.clearInterval(timer);
                    }
                    timer = Timer.setInterval(poll, ERROR_INTERVAL);
                    console.log("Unhandled response: " + req.status + ", retrying...")
                }
                updateStatus();
                freeRequest(ev);
            };

            var transferFailed = function (ev) {
                console.log('transferFailed()');
                freeRequest(ev);
            };

            var transferCanceled = function (ev) {
                console.log('transferCanceled()');
                freeRequest(ev);
            };

            var updateStatus = function () {
                var state = getCurrentUploadState();
                self.dispatch(new ProgressEvent(state));
            };

            return self;
        };

        return UploadManager;
    });