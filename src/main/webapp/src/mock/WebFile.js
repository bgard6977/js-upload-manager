/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
define(function(require, exports, module) {
    var WebFile = function(contentType, relativePath) {
        var self = {};

        self.getContentType = function() {
            return contentType;
        };

        self.getRelativePath = function() {
            return relativePath;
        };

        return self;
    };

    return WebFile;
});
