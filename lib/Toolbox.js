var flow = require('js-flow');

module.exports = {
    loop: function (conditionFn, delay, done) {
        if (typeof(delay) == 'function') {
            done = delay;
            delay = 200;
        }
        flow.loop()
            .while(conditionFn)
            .do(function (next) {
                setTimeout(next, delay);
            })
            .run(done);
        return this;
    },

    until: function (conditionFn, delay, done) {
        if (typeof(delay) == 'function') {
            done = delay;
            delay = 200;
        }
        flow.loop()
            .while(function (next) {
                conditionFn(function (err, result) {
                    if (typeof(err) == 'boolean') {
                        result = err;
                        err = null;
                    }

                    next(err, !result);
                });
            })
            .do(function (next) {
                setTimeout(next, delay);
            })
            .run(done);
        return this;
    }
};
