/*
 * js-upload-manager
 * https://github.com/bgard6977/js-upload-manager/
 *
 * Copyright (c) 2014 Brent Gardner
 * Licensed under the MIT license.
 */
/**
 * The default renderer for DataGrid rows
 */
define(function(require, exports, module) {

    var RowRenderer = function(columnNames) {

        var self = {};

        // ----------------------------------------- Private members --------------------------------------------------

        // ----------------------------------------- Public methods ---------------------------------------------------
        self.render = function(index, item) {
            var row = $('<tr/>');
            for(var i = 0; i < columnNames.length; i++) {
                var column = columnNames[i];
                var val = item[column];
                self.addCell(row, val);
            }
            return row;
        };

        self.addCell = function(row, el) {
            var text = el ? el.textContent : '';
            row.append($('<td/>').html(text));
        };

        // ----------------------------------------- Private methods --------------------------------------------------

        // ------------------------------------------- Constructor ----------------------------------------------------
        var ctor = function() {
        };

        ctor();

        return self;
    };

    return RowRenderer;
});