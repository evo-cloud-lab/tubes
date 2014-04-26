/** @fileoverview
 * Provide CloudService
 */

var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    glob  = require('glob'),
    spawn = require('child_process').spawn,
    Logger = require('evo-elements').Logger,
    NeuronClient = require('evo-idioms').NeuronClient,
    Toolbox = require('./Toolbox');

var ServiceProcess = Class({
    constructor: function (service, index, executable, args, options) {
        this._service = service;
        this._index = index;
        this._executable = executable;
        this._args = args;
        this._options = options;
        this._trace = service.container.res('env').tracer(service.name, index);
    },

    get pid () {
        return this._process ? this._process.pid : undefined;
    },

    get starting () {
        return this._process && this._starting;
    },

    get running () {
        return this._process && !this._starting;
    },

    get stopped () {
        return !this._process;
    },

    get exitStatus () {
        return this._exitStatus;
    },

    start: function (done) {
        if (this._process) {
            throw new Error('Process already started');
        }

        this._trace('STARTING ' + this._executable + ' ' + this._args.join(' '));

        delete this._exitStatus;

        this._starting = {
            callback: done
        };

        this._process = spawn(this._executable, this._args, {
            cwd: this._options.cwd,
            env: process.env,
            stdio: 'ignore'
        });

        this._starting.timer = setTimeout(this._started.bind(this), 1000);
        this._process.on('error', this.onError.bind(this));
    },

    stop: function () {
        if (!this.stopped) {
            this._process.kill();
        }
    },

    onExit: function (code, signal) {
        this._trace('EXITED: %d, %s', code, signal);
        this._exitStatus = {
            code: code,
            signal: signal
        };
        delete this._process;
    },

    onError: function (err) {
        if (this._starting) {
            this._trace('FAILED TO START: ' + err.message);
            clearTimeout(this._starting.timer);
            var callback = this._starting.callback;
            delete this._starting;
            delete this._process;
            callback && callback(err);
        } else {
            this._trace('ERROR: ' + err.message);
            this._exitStatus = err;
            delete this._process;
        }
    },

    _started: function () {
        if (this._starting) {
            this._trace('STARTED');
            clearTimeout(this._starting.timer);
            var callback = this._starting.callback;
            delete this._starting;
            this._process.on('exit', this.onExit.bind(this));
            callback && callback();
        }
    }
});

/** @class CloudService
 * @description Manages a cloud service with common configurations
 */
var CloudService = Class({
    constructor: function (name, options, defaultOpts) {
        typeof(options) == 'object' || (options = {});
        this._name = name;
        this._instances = parseInt(options.instances);
        this._config = function (index) {
            var conf = {};
            if (defaultOpts && defaultOpts.config) {
                conf = defaultOpts.config(index);
            }
            if (typeof(options.config) == 'function') {
                conf = options.config(index, conf || {});
            }
            return conf;
        };
        this._client    = options.client || (defaultOpts && defaultOpts.client);
        this._proxy     = options.proxy;
        this._logPrefix = options.logPrefix || (defaultOpts && defaultOpts.logPrefix) || ('<' + name + '> ');
        this._processes = [];
        this._excludes = {};
    },

    start: function (done) {
        var env = this.container.res('env');
        if (isNaN(this._instances)) {
            this._instances = env.nodes;
        }

        this._logger = Logger.clone(env.logger, { prefix: this._logPrefix });
        this._trace = env.tracer(this.name);

        var config, executable;
        var service = env.config.query('services.' + this.name);
        if (typeof(service) == 'string') {
            executable = path.resolve(env.baseDir, service);
        } else if (service && typeof(service.config) == 'object') {
            config = service.config;
        }
        if (!executable) {
            try {
                glob.sync(path.join(env.baseDir, '*', 'package.json'))
                    .some(function (file) {
                        this.logger.debug('Checking ' + this.name + ' with ' + file);
                        var pkg = JSON.parse(fs.readFileSync(file).toString());
                        if (pkg && pkg.bin && pkg.name == this.name) {
                            if (typeof(pkg.bin) == 'string') {
                                executable = path.resolve(env.baseDir, path.dirname(file), pkg.bin);
                            } else if (pkg.bin[this.name]) {
                                executable = path.resolve(env.baseDir, path.dirname(file), pkg.bin[this.name]);
                            }
                        }
                        return !!executable;
                    }.bind(this));
            } catch (e) {
                env.logger.logError(e);
                // ignored
            }
        }
        if (!executable) {
            done(new Error('No executable found for service ' + this.name));
            return;
        }

        flow.times(this._instances)
            .do(function (index, next) {
                var dir = path.join(env.workDir, index.toString());
                var args = [
                    '--neuron-dendrite-sock=' + path.join(dir, 'neuron-${name}.sock'),
                    '--logger-level=DEBUG',
                    '--logger-drivers-file-driver=file',
                    '--logger-drivers-file-options-filename=' + path.join(dir, this.name + '.log')
                ];

                var generateConfig = function (index, config) {
                    typeof(config) == 'function' && (config = config(index));
                    return JSON.stringify(config);
                };
                this._config && args.push('-D', '.+=' + generateConfig(index, this._config));
                config && args.push('-D', '.+=' + generateConfig(index, config));

                flow.steps()
                    .next(function (next) {
                        env.dir(path.join(dir, this.name), next);
                    })
                    .next(function (next) {
                        var proc = new ServiceProcess(this, index, executable, args, { cwd: path.join(dir, this.name) });
                        this._processes[index] = proc;
                        proc.start(next);
                    })
                    .with(this)
                    .run(next);
            })
            .with(this)
            .run(done);
    },

    cleanup: function (done) {
        this._clients && this._clients.forEach(function (client) {
            client.disconnect();
        });
        this._processes.forEach(function (proc) {
            proc.stop();
        });
        done();
    },

    res: function (key) {
        return key == 'cloud-svc:' + this.name || key == this.name ? this : null;
    },

    get name () {
        return this._name;
    },

    get logger () {
        return this._logger;
    },

    get instances () {
        return this._instances;
    },

    get processes () {
        return this._processes;
    },

    get clients () {
        if (!this._clients) {
            this._clients = [];
            for (var i = 0; i < this.instances; i ++) {
                var neuron = this.container.res('neuron').neuron(i, {
                    connects: this._client,
                    proxy: this._proxy
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
                this._clients[i] = this.createClient ? this.createClient(neuron) : new NeuronClient(this._client, neuron);
            }
        }
        return this._clients;
    },

    clientsReady: function (done) {
        this._trace('clientsReady...');
        Toolbox.loop(function (next) {
            this.logger.debug('CLIENTS: %j', this.clients.map(function (n) { return n.state; }));
            next(this.clients.some(function (client, index) {
                return !this._excludes[index] && client.state != 'connected';
            }.bind(this)));
        }.bind(this), done);
        return this;
    },

    get excludes () {
        return this._excludes;
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

    shutdown: function (index, done) {
        this._trace('shutdown %d ...', index);
        this.exclude(index, true);
        this.processes[index].stop();
        Toolbox.until(function (next) {
            this.logger.debug('[%d] STOPPING %d: %j', index, this.processes[index].pid, this.processes[index].exitStatus);
            next(!!this.processes[index].stopped);
        }.bind(this), 100, done);
        return this;
    },

    respawn: function (index, done) {
        this._trace('respawn %d ...', index);
        this.exclude(index, false);
        this.processes[index].start(done);
        return this;
    }
});

module.exports = CloudService;
