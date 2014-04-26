var Class  = require('js-class'),
    path   = require('path'),
    _      = require('underscore'),
    Config = require('evo-elements').Config,
    neuron = require('evo-neuron');

var NeuronFactory = Class({
    constructor: function () {
    },

    start: function (done) {
        done();
    },

    cleanup: function (done) {
        done();
    },

    res: function (key) {
        return key == 'neuron' ? this : null;
    },

    neuron: function (index, options) {
        var env = this.container.res('env');
        var dir = path.join(env.workDir, index.toString());
        if (options && options.dir) {
            dir = path.resolve(env.workDir, options.dir);
        }
        var opts = _.clone(options || {});
        delete opts.neuron;
        delete opts.proxy;
        opts.config = new Config({
            neuron: _.extend({
                dendrite: {
                    sock: path.join(dir, options && options.proxy ? 'neuron-${name}.proxy.sock' : 'neuron-${name}.sock')
                },
                synapse: {
                    connectOpts: {
                        reconnectMax: -1
                    }
                }
            }, options && options.neuron || {})
        });
        return new neuron.Neuron(opts);
    }
});

module.exports = NeuronFactory;
