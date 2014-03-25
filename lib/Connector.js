var Class = require('js-class'),
    flow  = require('js-flow'),
    Logger = require('evo-elements').Logger,
    ConnectorClient = require('evo-idioms').ConnectorClient,

    Toolbox      = require('./Toolbox'),
    CloudService = require('./CloudService');

var Connector = Class(CloudService, {
    constructor: function (options) {
        CloudService.prototype.constructor.call(this, 'evo-connector', {
            instances: options.instances,
            config: function (index) {
                var conf = {
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

                typeof(options.config) == 'function' && (conf = options.config(index, conf));
                return conf;
            }
        });
        this._excludes = {};
    },

    start: function (done) {
        this._logger = Logger.clone(this.container.res('env').logger, { prefix: '<connector> ' });
        return CloudService.prototype.start.call(this, done);
    },

    cleanup: function (done) {
        this._clients && this._clients.forEach(function (client) {
            client.neuron.disconnect();
        });
        return CloudService.prototype.cleanup.call(this, done);
    },

    res: function (key) {
        return key == 'connector' ? this : CloudService.prototype.connect.call(this, key);
    },

    exclude: function (indices, excluded) {
        Array.isArray(indices) || (indices = [indices]);
        excluded = excluded == null ? false : !!excluded;
        indices.forEach(function (index) {
            if (excluded) {
                this._excludes[index] = true;
            } else {
                delete this._excludes[index];
            }
        }, this);
        return this;
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
            this.logger.verbose('ensureReady...');
            var masterCount = 0, memberCount = 0;
            nodesInfo.forEach(function (clusterInfo) {
                if (clusterInfo) {
                    clusterInfo.state == 'master' ? (masterCount ++) : (memberCount ++);
                }
            });
            var excludesCount = Object.keys(this._excludes).length;
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

    shutdown: function (index, done) {
        this.logger.verbose('shutdown %d ...', index);
        this.exclude(index, true);
        this.processes[index].stop();
        Toolbox.until(function (next) {
            this.logger.debug('[%d] STOPPING %d: %j', index, this.processes[index].pid, this.processes[index].exitStatus);
            next(!!this.processes[index].stopped);
        }.bind(this), 100, done);
        return this;
    },

    shutdownMaster: function (done) {
        this.logger.verbose('shutdownMaster...');
        this.shutdown(this.masterIndex, done);
        return this;
    },

    respawn: function (index, done) {
        this.logger.verbose('respawn %d ...', index);
        this.exclude(index, false);
        this.processes[index].start(done);
        return this;
    },

    untilUnstable: function (done) {
        this.logger.verbose('untilUnstable...');
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

    get logger () {
        return this._logger;
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

    get clients () {
        if (!this._clients) {
            this._clients = [];
            for (var i = 0; i < this.instances; i ++) {
                var neuron = this.container.res('neuron').neuron(i, {
                    connects: 'connector'
                }).start();
                (function (index, neuron, logger) {
                    var prefix = 'NEURON[' + index + ']: ';
                    neuron
                        .on('error', function (err) {
                            logger.logError(err, { level: 'debug', message: prefix + err.message });
                        })
                        .on('state', function (state, branch) {
                            logger.debug(prefix + '[' + branch + '] ' + state);
                        })
                        .on('message', function (msg, info) {
                            logger.debug(prefix + 'MSG (%j) %j', info, msg);
                        });
                })(i, neuron, this.logger);
                this._clients[i] = new ConnectorClient(neuron);
            }
        }
        return this._clients;
    },

    clientsReady: function (done) {
        this.logger.verbose('clientsReady...');
        Toolbox.loop(function (next) {
            this.logger.debug('CLIENTS: %j', this.clients.map(function (n) { return n.state; }));
            next(this.clients.some(function (client, index) {
                return !this._excludes[index] && client.state != 'connected';
            }.bind(this)));
        }.bind(this), done);
        return this;
    },

    sync: function (done) {
        flow.each(this.clients)
            .keys()
            .map(function (index, client, next) {
                if (this._excludes[index]) {
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
