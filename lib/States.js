var Class = require('js-class'),
    flow  = require('js-flow'),
    Logger = require('evo-elements').Logger,
    StatesClient = require('evo-idioms').StatesClient,

    Toolbox      = require('./Toolbox'),
    CloudService = require('./CloudService');

var States = Class(CloudService, {
    constructor: function (options) {
        CloudService.prototype.constructor.call(this, 'evo-states', options, {
            client: 'states',
            config: function (index) {
                return {
                    states: {
                    }
                };
            }
        });
    },

    createClient: function (neuron) {
        return new StatesClient(neuron);
    },

    ensureReady: function (done) {
        flow.parallel()
            .do(function (next) {
                this.container.res('evo-connector').ensureReady(next);
            })
            .do(function (next) {
                this.clientsReady(next);
            })
            .with(this)
            .run(done);
        return this;
    },

    waitForSync: function (query, syncLogic, done) {
        this._trace('waitForSync: %j', query);
        Toolbox.until(function (next) {
            flow.each(this.clients)
                .keys()
                .every(function (index, client, next) {
                    client.query(query, function (err, data) {
                        var result = err ? false : syncLogic(data, client, index);
                        this.logger.debug('QUERY[%d] => %j: %j', index, data, result);
                        next(err, result);
                    }.bind(this));
                })
                .with(this)
                .run(next);
        }.bind(this), done);
    }
});

module.exports = States;
