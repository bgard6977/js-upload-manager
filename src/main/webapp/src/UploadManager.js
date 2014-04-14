/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
/**
 * A resilient upload manager that keeps files in local storage until uploads can be completed
 *
 * @param FileReader A FileReader // TODO: DI framework
 * @param XMLHttpRequest A XMLHttpRequest // TODO: DI framework
 * @param window A window object // TODO: DI framework
 * @returns {{}} The UploadManager
 * @constructor
 */
var UploadManager = function(FileReader, XMLHttpRequest, window) {
    var self = {};

    // Upload constants
    var CHUNK_SIZE = 20 * 1024;     // Set as needed according to bandwidth & latency
    var POLL_INTERVAL = 10;         // Set as needed according to bandwidth & latency
    var POST_URL = 'upload.php';

    var INTEGER = {
        'MAX_VALUE': Math.pow(2, 32)
    };

    var timer = null;
    var running = false;
    var uploading = false;

    /**
     * Puts a file in the upload queue
     * @param file The file to enqueue
     */
    self.enqueue = function(file) {
        // Save meta data
        var state = new UploadState(self.nextKey());
        state.setFilename(file.name);
        state.setMimeType(file.type);
        state.setPosition(0);
        state.save();

        // Read the file from the disk
        var reader = new FileReader();
        reader.onload = function(ev) {
            var data = ev.target.result;
            state.setData(data);
            state.save();
        };
        reader.readAsArrayBuffer(file);
    };

    /**
     * Starts uploading the file queue to the server
     */
    self.upload = function() {
        if(timer !== null) {
            return; // Already running
        }
        running = true;
        timer = window.setInterval(poll, POLL_INTERVAL);
    };

    /**
     * Stops any uploads in progress
     */
    self.stop = function() {
        if(running === false) {
            return;
        }
        window.clearInterval(timer);
        timer = null;
        running = false;
    };

    /**
     * Removes all pending uploads from local storage
     */
    self.clear = function() {
        for(var key in localStorage) {
            if(!localStorage.hasOwnProperty(key)) {
                continue;
            }
            if(!isInt(key)) {
                continue;
            }
            localStorage.removeItem(key);
        }
    };

    /**
     * Event listener for progress
     */
    self.onProgress = function(state) {
    };

    /**
     * Event listener for completion
     */
    self.onFileComplete = function() {
    };

    var isInt = function(value) {
        return value == parseInt(value);
    };

    /**
     * @returns {number} The key of the next file to upload
     */
    self.minKey = function() {
        var min = INTEGER.MAX_VALUE;
        for(var key in localStorage) {
            if(!localStorage.hasOwnProperty(key)) {
                continue;
            }
            if(!isInt(key)) {
                continue;
            }
            min = Math.min(min, parseInt(key));
        }
        if(min === INTEGER.MAX_VALUE) {
            return 0;
        }
        return min;
    };

    /**
     * @returns {number} The key of the current upload, or 0
     */
    self.activeKey = function() {
        var max = 0;
        for(var key in localStorage) {
            if(!localStorage.hasOwnProperty(key)) {
                continue;
            }
            max = Math.max(max, parseInt(key));
        }
        return max;
    };

    /**
     * @returns {number} The key where the next upload should be stored
     */
    self.nextKey = function() {
        return self.activeKey() + 1;
    };

    /**
     * @returns {UploadState|null} The current thing to upload, or null
     */
    self.getCurrentUploadState = function() {
        // See if there are things to upload
        var minKey = self.minKey();
        if(minKey === 0) {
            return null;
        }

        // Grab the next thing to upload
        var state = new UploadState(minKey);
        state.load();
        if(state.getLength() === 0) {
            return null; // File data not yet loaded
        }

        return state;
    };

    /**
     * @param state The upload state
     * @returns {number} The index+1 of the last byte to send
     */
    var getNextEnd = function(state) {
        var nextPos = state.getPosition() + CHUNK_SIZE;
        return Math.min(nextPos, state.getLength());
    };

    /**
     * @param state The upload state
     * @returns {number} The size of the next chunk to upload
     */
    var getNextChunkSize = function(state) {
        var end = getNextEnd(state);
        return end - state.getPosition();
    };

    var completeUpload = function(state) {
        state.free();
        updateStatus();
        self.onFileComplete();
    };

    /**
     * Called periodically to check for work, and advance if possible
     */
    var poll = function() {
        //console.log('poll() Polling for work...')
        if(uploading) {
            return; // Don't be re-entrant
        }

        // Get the current upload state
        var state = self.getCurrentUploadState();
        if(state === null) {
            console.log('poll() No work found, aborting.');
            self.stop();
            return; // Nothing to upload, or data still being loaded from disk
        }

        // Grab the next chunk to upload
        var chunk = getNextChunk(state);
        if(chunk === null) {
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
    var getNextChunk = function(state) {
        var chunkSize = getNextChunkSize(state);
        if(chunkSize <= 0) {
            return null;
        }
        return new Uint8Array(state.getData(), state.getPosition(), chunkSize);
    };

    var sendNextChunk = function(state) {
        var abv = getNextChunk(state);
        //console.log('sendNextChunk() sending ' + abv.length + ' bytes..')
        //state.startUpload(abv.length); // TODO: Put tracking back in
        var req = createNextRequest(state);
        uploading = true;
        req.send(abv);
    };

    var buildContentRange = function(state) {
        var end = getNextEnd(state);

        var text = 'bytes ';
        text += state.getPosition();
        text += '-';
        text += (end-1);
        text += '/';
        text += state.getLength();

        return text;
    };

    var createNextRequest = function(state) {

        var req = new XMLHttpRequest();
        req.addEventListener('progress', updateProgress, false);
        req.addEventListener('load', transferComplete, false);
        req.addEventListener('error', transferFailed, false);
        req.addEventListener('abort', transferCanceled, false);
        req.open('POST', POST_URL, true);

        var contentRange = buildContentRange(state);
        console.log('createNextRequest() ' + state.getFilename() + ' ' + contentRange);
        req.setRequestHeader('HTTP_X_FILENAME', state.getFilename());
        req.setRequestHeader('Content-Range', contentRange);
        req.overrideMimeType(state.getMimeType());

        return req;
    };

    var freeRequest = function(ev) {
        var req = ev.target;
        req.removeEventListener('progress', updateProgress);
        req.removeEventListener('load', transferComplete);
        req.removeEventListener('error', transferFailed);
        req.removeEventListener('abort', transferCanceled);
        uploading = false;
    };

    // -------------------------------------------- Status events -----------------------------------------------------
    var updateProgress = function(ev) {
        // TODO: Fire onProgress?
    };

    var transferComplete = function(ev) {
        //console.log('transferComplete()')

        var state = self.getCurrentUploadState();
        //state.endUpload(); // TODO: Put tracking back in
        updateStatus();
        if(state !== null) {
            state.setPosition(state.getPosition() + CHUNK_SIZE);
            state.save();
        }
        freeRequest(ev);
    };

    var transferFailed = function(ev) {
        console.log('transferFailed()');
        //var state = self.getCurrentUploadState();
        //state.endUpload();  // TODO: Put tracking back in
        freeRequest(ev);
    };

    var transferCanceled = function(ev) {
        console.log('transferCanceled()');
        //var state = self.getCurrentUploadState();
        //state.endUpload();  // TODO: Put tracking back in
        freeRequest(ev);
    };

    var updateStatus = function() {
        var state = self.getCurrentUploadState();
        try {
            self.onProgress(state);
        } catch (ex) {
            console.log(ex);
        }
    };

    return self;
};