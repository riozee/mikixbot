try {
    const { create, all } = require('mathjs');
    const math = create(all);

    math.import(
        {
            import: function () {
                throw new Error('Function import is disabled');
            },
            createUnit: function () {
                throw new Error('Function createUnit is disabled');
            },
            evaluate: function () {
                throw new Error('Function evaluate is disabled');
            },
            parse: function () {
                throw new Error('Function parse is disabled');
            },
            simplify: function () {
                throw new Error('Function simplify is disabled');
            },
            derivative: function () {
                throw new Error('Function derivative is disabled');
            },
        },
        { override: true }
    );

    let hasil = math.evaluate(process.argv[2]);
    if (hasil.values) {
        if (hasil.size === 1) {
            const val = hasil.values()[0];
            hasil = val.syntax ?? val;
        } else {
            const formatted = [];
            for (const [idx, entry] of hasil.entries()) {
                formatted.push(`(${idx + 1}) ` + (entry.syntax ?? entry));
            }
            hasil = formatted.join('\n');
        }
    }
    process.send({ h: hasil.toString() });
} catch (e) {
    process.send({ e: String(e) });
}
