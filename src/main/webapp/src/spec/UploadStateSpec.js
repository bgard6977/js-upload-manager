/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
define([
    'filters/ResizeFilter',
    'real/localStorage',
    'resource/Resources',
    'uploads/UploadState'
], function (ResizeFilter, localStorage, Resources, UploadState) {
    describe('UploadState', function () {

        var MIME_TYPE = 'application/octet-stream';

        var FILE_1 = Resources.getImage1();
        var FILE_1_SIZE = 115063;
        var KEY = '1';

        beforeEach(function () {
        });

        it('should be instantiable', function () {
            var state = new UploadState(KEY, localStorage);
            expect(state.getFilename()).toBeNull();
            expect(state.getMimeType()).toBe(MIME_TYPE);
            expect(state.getPosition()).toBe(0);
            expect(state.getData()).toBeNull();
        });

        it('should be recoverable', function () {
            var oldState = new UploadState(KEY, localStorage);
            oldState.setPosition(100);
            oldState.setFilename('foo');
            oldState.setMimeType('bar');
            oldState.setData(FILE_1);
            oldState.save();

            var newState = new UploadState(KEY, localStorage);
            newState.load();
            expect(newState.getPosition()).toBe(100);
            expect(newState.getFilename()).toBe('foo');
            expect(newState.getMimeType()).toBe('bar');
            expect(newState.getLength()).toBeGreaterThan(1000);
        });

        it('can be deleted', function () {
            var state = new UploadState(KEY, localStorage);
            state.setPosition(100);
            state.setFilename('foo');
            state.setMimeType('bar');
            state.setData(FILE_1);
            state.save();

            expect(localStorage.getItem(KEY)).toBeDefined();
            state.free();
            expect(localStorage.getItem(KEY)).toBeNull();
        });
    });
});
