var Class = require('js-class'),
    flow  = require('js-flow'),
    ConnectorClient = require('evo-idioms').ConnectorClient,

    Toolbox      = require('./Toolbox'),
    CloudService = require('./CloudService');

var Connector = Class(CloudService, {
    constructor: function (options) {
        CloudService.prototype.constructor.call(this, 'evo-connector', options, {
            client: 'connector',
            config: function (index) {
                return {
                    connector: {
                        id: 'evo-connector-' + index,
                        cluster: 'evo-connector-test',
                        port: 12710 + index,
                        address: '0.0.0.0',
                        broadcast: '224.1.0.0:22410',
                        //announceIntervals: [100, 100, 100, 100, 200, 200, 200],
                        //identityTimeout: 100,
                        //communicateTimeout: 600,
                        //membershipTimeout: 300,
                        //synapse: {
                        //    reconnectDelay: 10,
                        //    reconnectMax: 1
                        //}
                    }
                };
            }
        });
    },

    createClient: function (neuron) {
        return new ConnectorClient(neuron);
    },

    ready: function (done) {
        this.logger.verbose('ready...');

        var nodesInfo;

        flow.steps()
            .next('clientsReady')
            .next(function (next) {
                Toolbox.until(function (next) {
                    this.sync(flow.Try.br(function (states) {
                        nodesInfo = states;
                        next(states.every(function (clusterInfo) {
                            return clusterInfo == null ||
                                   ['master', 'member'].indexOf(clusterInfo.state) >= 0;
                        }));
                    }, next));
                }.bind(this), next);
            })
            .with(this)
            .run(function (err) {
                done(err, nodesInfo);
            });

        return this;
    },

    ensureReady: function (done) {
        this.ready(flow.Try.br(function (nodesInfo) {
            this._trace('ensureReady...');
            var masterCount = 0, memberCount = 0;
            nodesInfo.forEach(function (clusterInfo) {
                if (clusterInfo) {
                    clusterInfo.state == 'master' ? (masterCount ++) : (memberCount ++);
                }
            });
            var excludesCount = Object.keys(this.excludes).length;
            if (masterCount == 1 &&
                masterCount + memberCount == this.instances - excludesCount) {
                done(null, nodesInfo);
            } else {
                done(new Error('Bad cluster state: masters=' + masterCount
                               + ', members=' + memberCount
                               + ', excludes=' + excludesCount));
            }
        }.bind(this), done));
        return this;
    },

    shutdownMaster: function (done) {
        this._trace('shutdownMaster...');
        this.shutdown(this.masterIndex, done);
        return this;
    },

    untilUnstable: function (done) {
        this._trace('untilUnstable...');
        var nodesInfo;

        flow.steps()
            .next('clientsReady')
            .next(function (next) {
                Toolbox.until(function (next) {
                    this.sync(flow.Try.br(function (states) {
                        nodesInfo = states;
                        next(states.some(function (clusterInfo) {
                            return clusterInfo &&
                                   ['master', 'member'].indexOf(clusterInfo.state) < 0;
                        }));
                    }, next));
                }.bind(this), next);
            })
            .with(this)
            .run(function (err) {
                done(err, nodesInfo);
            });

        return this;
    },

    get states () {
        return this._states;
    },

    set states (val) {
        this.logger.debug('STATES: %j', val.map(function (s) { return s ? s.state : '<excl>'; }));
        this._states = val;
        delete this._masterIndex;
        this._states.some(function (clusterInfo, index) {
            if (clusterInfo && clusterInfo.state == 'master') {
                this._masterIndex = index;
                return true;
            }
            return false;
        }.bind(this));
        return this._states;
    },

    get masterIndex () {
        return this._masterIndex;
    },

    get master () {
        return this._clients && this._clients[this._masterIndex];
    },

    sync: function (done) {
        flow.each(this.clients)
            .keys()
            .map(function (index, client, next) {
                if (this.excludes[index]) {
                    next();
                } else {
                    client.sync(function (err, data) {
                        err && this.logger.logError(err);
                        next(err, data);
                    }.bind(this));
                }
            })
            .with(this)
            .run(function (err, states) {
                !err && (this.states = states);
                done(err, states);
            });
        return this;
    }
});

module.exports = Connector;
