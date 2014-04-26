var Class  = require('js-class'),
    flow   = require('js-flow'),
    path   = require('path'),
    _      = require('underscore'),
    Config = require('evo-elements').Config,
    neuron = require('evo-neuron');

var Relay = Class(process.EventEmitter, {
    constructor: function (receiver, sender, filter) {
        this._receiver = receiver;
        this._sender = sender;
        this._receiver
            .on('message', this.onMessage.bind(this))
            .on('error', this.onError.bind(this))
            .on('close', this.onClose.bind(this));
        this._filter = filter;
    },

    disconnect: function () {
        this._receiver.disconnect();
    },

    onMessage: function (msg) {
        if (this._filter(msg, this._receiver)) {
            this._sender.send(msg);
        }
    },

    onError: function (err) {

    },

    onClose: function () {
        this._sender.disconnect();
        this.emit('disconnect');
    }
});

var Joint = Class(process.EventEmitter, {
    constructor: function (id, incoming, outgoing, filter) {
        this._id = id;
        this._relays = [
            new Relay(incoming, outgoing, function (msg, src) { return filter(msg, src); })
                .on('disconnect', this.onDisconnect.bind(this)),
            new Relay(outgoing, incoming, function (msg, src) { return filter(msg, src, true); })
                .on('disconnect', this.onDisconnect.bind(this))
        ];
    },

    get id () {
        return this._id;
    },

    disconnect: function () {
        this._relays.forEach(function (relay) { relay.disconnect(); });
        return this;
    },

    onDisconnect: function () {
        if (!this._disconnected) {
            this._disconnected = true;
            this.emit('disconnect', this);
        }
    }
});

var Proxy = Class({
    constructor: function (host, index, env) {
        this._host = host;
        this._index = index;
        this._sock = path.join(env.workDir, index.toString(), 'neuron-' + host.name + '.sock');
        this._sockProxy = path.join(env.workDir, index.toString(), 'neuron-' + host.name + '.proxy.sock');
    },

    start: function (callback) {
        this._jointId = 0;
        this._joints = {};
        this._receptor = neuron.Synapse.listen('unix:' + this._sockProxy)
                .on('connection', this.onConnection.bind(this))
                .on('error', this._receptorError.bind(this))
                .on('close', this._receptorClose.bind(this))
                .on('ready', function () {
                         callback && callback();
                    });
        return this;
    },

    stop: function (callback) {
        this._receptor.close();
        for (var id in this._joints) {
            this._joints[id].removeAllListeners();
            this._joints[id].disconnect();
        }
        callback();
        return this;
    },

    onConnection: function (connection) {
        var outgoing = neuron.Synapse.connect('unix:' + this._sock, { reconnectMax: 0 });
        var id = ++ this._jointId;
        var joint = new Joint(id, connection, outgoing, this._filter.bind(this));
        this._joints[id] = joint;
        joint.on('disconnect', this._jointDisconnect.bind(this));
    },

    _receptorError: function (err) {

    },

    _receptorClose: function () {

    },

    _jointDisconnect: function (joint) {
        delete this._joints[joint.id];
    },

    _filter: function (msg, src, response) {
        for (var i in this._host.filters) {
            var filter = this._host.filters[i];
            var result = filter(msg, src, response);
            if (typeof(result) == 'boolean') {
                return result;
            }
        }
        return true;
    }
});

var NeuronProxy = Class({
    constructor: function (name) {
        this._name = name;
        this._filters = [];
    },

    start: function (done) {
        var env = this.container.res('env');
        this._logger = Logger.clone(env.logger, { prefix: '<' + this.name + '.proxy> ' });
        this._proxies = [];
        for (var i = 0; i < env.nodes; i ++) {
            this._proxies[i] = new Proxy(this, i, env);
        }
        flow.each(this._proxies)
            .do('&start')
            .run(done);
    },

    cleanup: function (done) {
        flow.each(this._proxies)
            .do('&stop')
            .run(done);
    },

    res: function (key) {
        return key == 'neuron.proxy:' + this.name || key == this.name + '.proxy' ? this : null;
    },

    get name () {
        return this._name;
    },

    get proxies () {
        return this._proxies;
    },

    filter: function (filterFn) {
        this._filters.push(filterFn);
        return this;
    }
});

module.exports = NeuronProxy;
