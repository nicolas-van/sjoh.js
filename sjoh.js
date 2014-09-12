/*
Copyright (c) 2014, Nicolas Vanhoren

Released under the MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

(function() {
    "use strict";

    window.sjoh = {};

    sjoh.TypeHandler = ring.create({
        javaScriptType: null,
        typeIdentifier: null,
        fromJson: function(dictionary, continueFunc) {},
        toJson: function(obj, continueFunc) {},
    });

    sjoh.DateTimeHandler = ring.create(sjoh.TypeHandler, {
        javaScriptType: Date,
        typeIdentifier: "datetime",
        fromJson: function(dictionary) {
            return new Date(dictionary.timestamp);
        },
        toJson: function(obj) {
            return {"timestamp": obj.getTime()};
        }
    });

    /*
        A simple date without time information.
    */
    sjoh.Date = ring.create({
        constructor: function(fullYear, month, date) {
            this.fullYear = fullYear;
            this.month = month; // 0-11
            this.date = date; // 1-31
        },
        toJsDate: function() {
            return new Date(this.fullYear, this.month, this.date);
        },
    });

    sjoh.DateHandler = ring.create(sjoh.TypeHandler, {
        javaScriptType: sjoh.Date,
        typeIdentifier: "date",
        fromJson: function(dictionary) {
            return new sjoh.Date(dictionary["year"], dictionary["month"] - 1, dictionary["day"]);
        },
        toJson: function(obj) {
            return {"year": obj.fullYear, "month": obj.month + 1, "day": obj.date};
        }
    });

    sjoh.GenericJsonException = ring.create(ring.Error, {
        name: "GenericJsonException",
        constructor: function(message, type, traceback) {
            this.$super(message);
            this.type = type;
            this.traceback = traceback;
        },
    });

    sjoh.toJsonException = function(obj) {
        return new sjoh.GenericJsonException(obj.message, obj.name);
    };

    sjoh.ExceptionHandler = ring.create(sjoh.TypeHandler, {
        javaScriptType: Error,
        typeIdentifier: "exception",
        fromJson: function(dictionary) {
            return new sjoh.GenericJsonException(dictionary.message, dictionary.type, dictionary.traceback);
        },
        toJson: function(obj) {
            if (! ring.instance(obj, sjoh.GenericJsonException)) {
                obj = toJsonException(obj);
            }
            return {"type": obj.type, "message": obj.message, "traceback": obj.traceback};
        }
    });

    sjoh.JsonSerializerException = ring.create(ring.Error, {
        name: "JsonSerializerException",
    });

    sjoh.JsonSerializer = ring.create({
        constructor: function() {
            this._handlers = {};
            this.addHandler(new sjoh.ExceptionHandler());
            this.addHandler(new sjoh.DateTimeHandler());
            this.addHandler(new sjoh.DateHandler());
        },
        toJsonTypes: function(data) {
            var self = this;
            if (ring.instance(data, "number") || ring.instance(data, "string") ||
                ring.instance(data, "boolean") || data === null) {
                return data;
            } else if (ring.instance(data, Array)) {
                var nl = [];
                _.each(data, function(i) {
                    nl.push(self.toJsonTypes(i));
                });
                return nl;
            } else if (ring.instance(data, "object") && data.constructor === Object) {
                var nd = {};
                _.each(data, function(v, k) {
                    nd[k] = self.toJsonTypes(v);
                });
                return nd;
            }
            var value = null;
            _.some(this._handlers, function(handler) {
                if (ring.instance(data, handler.javaScriptType)) {
                    value = handler.toJson(data, _.bind(self.toJsonTypes, self));
                    value.__type__ = handler.typeIdentifier;
                    return true;
                }
            });
            if (value)
                return value;
            else
                throw new sjoh.JsonSerializerException("Impossible to serialize object " + data);
        },
        fromJsonTypes: function(data) {
            var self = this;
            if (data === null || ring.instance(data, "number") || ring.instance(data, "string") ||
                ring.instance(data, "boolean")) {
                return data;
            } else if (ring.instance(data, Array)) {
                var nl = [];
                _.each(data, function(i) {
                    nl.push(self.fromJsonTypes(i));
                });
                return nl;
            } else if (ring.instance(data, "object")) {
                if (data.__type__ !== undefined) {
                    var handler = self._handlers[data.__type__];
                    if (! handler)
                        throw new sjoh.JsonSerializerException("Could not find handler for type " + data.__type__);
                    return handler.fromJson(data, _.bind(self.fromJsonTypes, self));
                } else {
                    var nd = {};
                    _.each(data, function(v, k) {
                        nd[k] = self.fromJsonTypes(v);
                    });
                    return nd;
                }
            }
            throw new JsonSerializerException("Unknown type " + data);
        },
        stringify: function(data) {
            var conv = this.toJsonTypes(data);
            return JSON.stringify(conv);
        },
        parse: function(text) {
            var toConv = JSON.parse(text);
            return this.fromJsonTypes(toConv);
        },
        addHandler: function(handler) {
            this._handlers[handler.typeIdentifier] = handler;
        },
    });

    sjoh.jsonSerializer = new sjoh.JsonSerializer();

    sjoh.CommunicationError = ring.create(ring.Error, {
        name: "CommunicationError",
        constructor: function(result) {
            this.$super("Communication error");
            this.httpMessage = result;
        },
    });

    sjoh.JsonCommunicator = ring.create({
        constructor: function() {
            this.jsonSerializer = new sjoh.JsonSerializer();
        },
        send: function(url) {
            var self = this;
            var args = _.toArray(arguments).slice(1);
            return Promise.cast(httpinvoke(url, "POST", {
                inputType: "text",
                input: self.jsonSerializer.stringify(args),
                headers: {'Content-Type': 'application/json'},
            })).then(function(result) {
                if (result.statusCode === 200) {
                    return self.jsonSerializer.parse(result.body);
                } else if (result.statusCode === 500) {
                    var ex = self.jsonSerializer.parse(result.body);
                    throw ex;
                } else {
                    throw new sjoh.CommunicationError(result);
                }
            });
        },
    });

})();
