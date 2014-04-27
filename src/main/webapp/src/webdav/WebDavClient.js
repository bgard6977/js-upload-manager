/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
/**
 * A WebDAV protocol compatible client
 */
define(function(require, exports, module) {

    var List = require('collections/List');

    var WebDavClient = function(rootPath) {

        var self = {};

        // ----------------------------------------- Private members --------------------------------------------------
        var path = '';
        var files = new List();

        // ----------------------------------------- Public methods ---------------------------------------------------
        self.getCurrentPath = function() {
            return rootPath + path;
        };

        self.getFiles = function() {
            return files;
        };

        self.createFolder = function(filename) {
            $.ajax({
                type: 'MKCOL',
                url: self.getCurrentPath() + filename,
                success: function() {
                    self.update();
                }
                // TODO: Handle failure
            });
        };

        self.update = function() {
            var propsBody = document.implementation.createDocument('DAV:', 'propfind', null);
            propsBody.documentElement.appendChild(propsBody.createElementNS('DAV:', 'allprop'));
            var serializer = new XMLSerializer();
            var str = '<?xml version="1.0" encoding="utf-8" ?>' + serializer.serializeToString(propsBody);

            $.ajax({
                type: 'PROPFIND',
                url: self.getCurrentPath(),
                data: str,
                dataType: 'xml',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('Depth', '1');
                    xhr.setRequestHeader('Content-Type', 'application/xml');
                },
                success: function(xml) {
                    readXml(xml);
                }
                // TODO: Handle failure
            });
        };

        // ----------------------------------------- Private methods --------------------------------------------------

        // TODO: Better OO (return files - don't change state)
        var readXml = function(xml) {
            files.clear();
            for(var statusIndex = 0; statusIndex < xml.children.length; statusIndex++) {
                var status = xml.children[statusIndex];
                for(var responseIndex = 0; responseIndex < status.children.length; responseIndex++) {
                    var response = status.children[responseIndex];
                    var propstat = response.getElementsByTagName('propstat')[0];
                    var href = response.getElementsByTagName('href')[0].innerHTML;
                    var props = response.getElementsByTagName('prop')[0];

                    href = href.substr(path.length);
                    var file = {
                        'href': path + href,
                        'contentType': props.getElementsByTagName('getcontenttype')[0],
                        'contentLength': props.getElementsByTagName('getcontentlength')[0],
                        'creationDate': props.getElementsByTagName('creationdate')[0],
                        'lastModified': props.getElementsByTagName('getlastmodified')[0]
                    };
                    files.addItem(file);
                }
            }
            return files;
        };

        // ------------------------------------------- Constructor ----------------------------------------------------
        var ctor = function() {
            self.update();
        };

        ctor();

        return self;
    };

    return WebDavClient;
});