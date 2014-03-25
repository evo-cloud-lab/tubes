/** @fileoverview
 * Provide CloudService
 */

var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    glob  = require('glob'),
    spawn = require('child_process').spawn;

var ServiceProcess = Class({
    constructor: function (index, executable, args, options) {
        this._index = index;
        this._executable = executable;
        this._args = args;
        this._options = options;
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
        this._exitStatus = {
            code: code,
            signal: signal
        };
        delete this._process;
    },

    onError: function (err) {
        if (this._starting) {
            clearTimeout(this._starting.timer);
            var callback = this._starting.callback;
            delete this._starting;
            delete this._process;
            callback && callback(err);
        } else {
            this._exitStatus = err;
            delete this._process;
        }
    },

    _started: function () {
        if (this._starting) {
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
    constructor: function (name, options) {
        typeof(options) == 'object' || (options = {});
        this._name = name;
        this._instances = parseInt(options.instances);
        isNaN(this._instances) && (this._instances = 1);
        this._config = options.config;
        this._processes = [];
    },

    start: function (done) {
        var env = this.container.res('env');
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
                        env.logger.debug('Checking ' + this.name + ' with ' + file);
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
                        var proc = new ServiceProcess(index, executable, args, { cwd: path.join(dir, this.name) });
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
        this._processes.forEach(function (proc) {
            proc.stop();
        });
        done();
    },

    res: function (key) {
        return key == 'cloud-svc:' + this._name ? this : null;
    },

    get name () {
        return this._name;
    },

    get instances () {
        return this._instances;
    },

    get processes () {
        return this._processes;
    }
});

module.exports = CloudService;
