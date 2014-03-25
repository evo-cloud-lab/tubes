/** @fileoverview
 * Provide Environment
 */

var Class = require('js-class'),
    flow  = require('js-flow'),
    fs    = require('fs'),
    path  = require('path'),
    mkdir = require('mkdirp'),
    rmdir = require('remove'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger;

var CONFIG_FILENAME = 'tubes.conf';

/** @class Environment
 * @description Prepare basic environment
 */
var Environment = Class({
    constructor: function (options) {
        this._baseDir = options && options.baseDir;
        if (!this._baseDir) {
            // find test configuration file
            var dir = __dirname;
            while (true) {
                var next = path.resolve(dir, '..');
                if (next == dir) {  // already root
                    break;
                }
                var conffile = path.join(next, CONFIG_FILENAME)
                if (fs.existsSync(conffile)) {
                    this._baseDir = next;
                    break;
                }
                dir = next;
            }
        }
        this._config = Config.conf(['-c', path.join(this._baseDir, CONFIG_FILENAME)]);
        this._workDir = this.config.query('work-dir', path.join(this._baseDir, '_test'));
    },

    start: function (done) {
        flow.steps()
            //.next(rmdir)
            .next(mkdir)
            .next(function(workdir, next) {
                var options = {
                    logger: {
                        level: 'DEBUG',
                        drivers: {
                            file: {
                                driver: 'file',
                                options: {
                                    filename: path.join(workdir, 'test.log'),
                                    options: { flags: 'w' }
                                }
                            }
                        }
                    }
                };
                if (process.env.TEST_CONSOLE_LOG_LEVEL) {
                    options.logger.drivers.console = {
                        driver: 'console',
                        options: {
                            level: process.env.TEST_CONSOLE_LOG_LEVEL
                        }
                    };
                }
                this._logger = new Logger('test', null, new Config(options));
                this.logger.notice('TEST START ' + new Date());
                next();
            })
            .with(this)
            .run(this.workDir, done);
    },

    cleanup: function (done) {
        this.logger.notice('TEST END ' + new Date());
        done();
    },

    res: function (key) {
        return key == 'env' ? this : null;
    },

    get baseDir () {
        return this._baseDir;
    },

    get workDir () {
        return this._workDir;
    },

    get logger () {
        return this._logger;
    },

    get config () {
        return this._config;
    },

    dir: function (name, done) {
        var dir = path.resolve(this.baseDir, name);
        mkdir(dir, function (err) {
            done(err, dir);
        });
        return this;
    }
});

module.exports = Environment;
