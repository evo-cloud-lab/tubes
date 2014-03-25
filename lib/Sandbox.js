/** @fileoverview
 * Provide Sandbox
 */

var Class = require('js-class'),
    flow  = require('js-flow');

/** @class Sandbox
 * @description Sandbox is a container for all resources which should be cleaned up
 * Sandbox instances can be nested
 */
var Sandbox = Class({
    constructor: function (options) {
        this._resources = [];
        this._concurrent = options && options.concurrent ? undefined : 1;
    },

    concurrent: function (concurrent) {
        this._concurrent = concurrent == undefined || concurrent ? undefined : 1;
        return this;
    },

    add: function (resource) {
        this._resources.push(resource);
        Object.defineProperty(resource, 'container', { value: this, enumerable: true });
        return this;
    },

    start: function (done) {
        this._started = [];
        flow.each(this._resources)
            .concurrent(this._concurrent)
            .do(function (res, next) {
                res.start(function (err) {
                    err || this._started.push(res);
                    next(err);
                }.bind(this));
            })
            .with(this)
            .run(function (err) {
                if (err) {
                    this.cleanup(function () {
                        done(err);
                    });
                } else {
                    done();
                }
            });
        return this;
    },

    cleanup: function (done) {
        flow.each(this._started)
            .concurrent(this._concurrent)
            .reverse()
            .do('&cleanup')
            .ignoreErrors()
            .run(done);
        return this;
    },

    res: function (key) {
        var result;
        this._resources.some(function (res) {
            result = typeof(res.res) == 'function' ? res.res(key) : null;
            return !!result;
        });
        return result;
    }
});

module.exports = Sandbox;
