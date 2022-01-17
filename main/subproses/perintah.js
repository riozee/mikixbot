const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const util = require('util');
const _ = require('lodash');
const fetch = require('node-fetch');
const chalk = require('chalk');

//////////////////// VARS

const argv = JSON.parse(process.argv[2]);
const TEKS = {};

for (const file of fs.readdirSync('./res/teks')) {
    TEKS[file.replace('.json', '')] = JSON.parse(fs.readFileSync('./res/teks/' + file));
}

log(0, Object.keys(TEKS));

const cache = {
    colors: {},
};

//////////////////// UTAMA

async function proses(pesan) {
    log(1, pesan);

    if (pesan._.teks) {
        if (/^[\/\-\\><+_=|~!?@#$%^&.]/.test(pesan._.teks)) {
            perintah(pesan);
        } else {
            log(3, pesan._.teks);
        }
    }
}

//////////////////// PERINTAH-PERINTAH

async function perintah(pesan) {
    const $ = pesan._;
    $.bahasa = 'id';
    const _perintah = $.teks.split(/\s+/)[0];

    $.argumen = $.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
    $.perintah = _perintah.slice(1).toLowerCase();
    $.arg = $.argumen || $.q?.teks;

    log(2, $.teks);
    logPesan(pesan.d, $);

    if (Perintah.hasOwnProperty($.perintah)) {
        const msg = {
            penerima: $.pengirim,
            mid: $.mid,
            re: true,
        };
        try {
            const hasil = {
                ...msg,
                ...(await Perintah[$.perintah]($)),
            };
            log(5, hasil);
            logPesan(pesan.d, hasil, true);
            return IPC.kirimSinyal(pesan.d, hasil);
        } catch (e) {
            log(6, $.teks);
            console.error(e);
            const hasil = {
                ...msg,
                teks: TEKS[$.bahasa]['system/error'],
            };
            logPesan(pesan.d, hasil, true);
            return IPC.kirimSinyal(pesan.d, hasil);
        }
    } else {
        log(4, $.perintah);
    }
}

const Perintah = {
    about: ($) => {
        return {
            teks: TEKS[$.bahasa]['command/about'],
        };
    },
    eval: async ($) => {
        if (!cekDev($.uid)) {
            return {
                teks: TEKS[$.bahasa]['permission/onlydev'],
            };
        }
        if (!$.argumen) {
            return {
                teks: TEKS[$.bahasa]['command/eval/noargs'],
            };
        }
        let hasil;
        try {
            hasil = await eval($.argumen);
        } catch (eror) {
            hasil = eror.stack ?? eror;
        } finally {
            return {
                teks: util.format(hasil),
            };
        }
    },
    help: () => Perintah.menu(),
    kbbi: async ($) => {
        if ($.arg) {
            try {
                const [ANTONIM, GABUNGANKATA, KATATURUNAN, ARTI, PERIBAHASA, TERKAIT, LIHATJUGA, SINONIM, TRANSLASI] = TEKS[$.bahasa]['command/kbbi/$words']
                    .split('|')
                    .map((v) => v.trim());
                const f = await fetch('https://kateglo.com/api.php?format=json&phrase=' + encodeURIComponent($.arg.trim()));
                const res = (await f.json()).kateglo;
                const kata = res.phrase ? res.phrase.toUpperCase() : res.phrase;
                const akar = res.root[0] ? res.root.map((v) => v.root_phrase).join(' -> ') : '';
                const kelasLeksikal =
                    res.lex_class_name || res.lex_class_ref ? (res.lex_class_name || res.lex_class_ref).toLowerCase() : res.lex_class_name || res.lex_class_ref;
                let definisi = '';
                (res.definition || []).forEach((v, i) => {
                    let teks = `\n${v.def_num || i + 1}. ${v.discipline ? `[${v.discipline}] ` : ''}${v.def_text}`;
                    if (v.sample) teks += `\n=> ${v.sample}`;
                    if (v.see) teks += `\n${LIHATJUGA}: ${v.see}`;
                    definisi += teks;
                });
                const sinonim = Object.values(res.relation?.s || {})
                    .filter((v) => v.related_phrase)
                    .map((v) => v.related_phrase)
                    .join(', ');
                const antonim = Object.values(res.relation?.a || {})
                    .filter((v) => v.related_phrase)
                    .map((v) => v.related_phrase)
                    .join(', ');
                const terkait = Object.values(res.relation?.r || {})
                    .filter((v) => v.related_phrase)
                    .map((v) => v.related_phrase)
                    .join(', ');
                const kataTurunan = Object.values(res.relation?.d || {})
                    .filter((v) => v.related_phrase)
                    .map((v) => v.related_phrase)
                    .join(', ');
                const gabunganKata = Object.values(res.relation?.c || {})
                    .filter((v) => v.related_phrase)
                    .map((v) => v.related_phrase)
                    .join(', ');
                const translasi = (res.translations || []).map((v) => `• [${v.ref_source}] ${v.translation}`).join('\n');
                let peribahasa = '';
                (res.proverbs || []).forEach((v) => {
                    peribahasa += `\n• ${v.proverb}\n${ARTI}: ${v.meaning}`;
                });
                const others = [
                    sinonim ? `${SINONIM}: ${sinonim.trim()}` : '',
                    antonim ? `${ANTONIM}: ${antonim.trim()}` : '',
                    terkait ? `${TERKAIT}: ${terkait.trim()}` : '',
                    kataTurunan ? `${KATATURUNAN}: ${kataTurunan.trim()}` : '',
                    gabunganKata ? `${GABUNGANKATA}: ${gabunganKata.trim()}` : '',
                    peribahasa ? `${PERIBAHASA}:\n${peribahasa.trim()}` : '',
                    translasi ? `${TRANSLASI}:\n${translasi.trim()}` : '',
                ]
                    .filter((v) => v)
                    .join('\n\n');
                return {
                    teks: `${akar ? `${akar} -> ` : ''}${kata} [${kelasLeksikal}]\n\n\n${definisi.trim()}\n\n${others}`,
                };
            } catch (eror) {
                return {
                    teks: TEKS[$.bahasa]['command/kbbi/error'] + '\n\n' + String(eror),
                };
            }
        } else {
            return {
                teks: TEKS[$.bahasa]['command/kbbi/noargs'],
            };
        }
    },
    lowercase: ($) => {
        if ($.arg) {
            return {
                teks: $.arg.toLowerCase(),
            };
        } else {
            return {
                teks: TEKS[$.bahasa]['command/lowercase/noargs'],
            };
        }
    },
    menu: ($) => ({
        teks: TEKS[$.bahasa]['command/menu'].replace(
            '%',
            Object.keys(Perintah)
                .map((v) => '/' + v)
                .join('\n')
        ),
    }),
    reversetext: ($) => {
        if ($.arg) {
            return {
                teks: _.split($.arg, '').reverse().join(''),
            };
        } else {
            return {
                teks: TEKS[$.bahasa]['command/reversetext/noargs'],
            };
        }
    },
    say: ($) => {
        return {
            teks: $.arg,
        };
    },
    uppercase: ($) => {
        if ($.arg) {
            return {
                teks: $.arg.toUpperCase(),
            };
        } else {
            return {
                teks: TEKS[$.bahasa]['command/uppercase/noargs'],
            };
        }
    },
};

//////////////////// FUNGSI PEMBANTU

function cekDev(id) {
    id = id.replace(/^[A-Z]{2,3}#/, '');
    for (const devId of argv.devids.split(',')) {
        if (id === devId) return true;
    }
    return false;
}

const DB = {
    buat: (data) =>
        IPC.kirimKueri('DB', {
            c: data,
        }),
    cari: (filter, banyak) =>
        IPC.kirimKueri('DB', {
            r: filter,
            m: banyak,
        }),
    perbarui: (filter, data, banyak) =>
        IPC.kirimKueri('DB', {
            u: [filter, data],
            m: banyak,
        }),
    hapus: (filter, banyak) =>
        IPC.kirimKueri('DB', {
            d: filter,
            m: banyak,
        }),
};

function logPesan(d, pesan, bot) {
    function getColor(id) {
        if (cache.colors.hasOwnProperty(id)) {
            return cache.colors[id];
        } else {
            return (cache.colors[id] = [_.random(0, 360), _.random(0, 75)]);
        }
    }
    const id = [bot ? chalk.hsv(...getColor('bot'), 100)('bot') : chalk.hsv(...getColor(pesan.uid), 100)(pesan.uid)];
    const chat = pesan.pengirim || pesan.penerima;
    if (bot || pesan.uid !== chat) {
        id.push(chalk.hsv(...getColor(chat), 100)(chat));
    }
    return console.log(new Date().toLocaleDateString(), new Date().toLocaleTimeString(), chalk.cyan(`<${d.toUpperCase()}>`), id.join(':'), pesan.teks);
}

////////////////////

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('_')) {
        if (pesan._.hasOwnProperty('pengirim')) {
            return await IPC.terimaSinyal(pesan, proses);
        }
    }
});

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[PERINTAH] [LOG] memuat file translasi`, // 0
            `[PERINTAH] [LOG] menerima pesan dari proses utama`, // 1
            `[PERINTAH] [LOG] terdapat perintah, memproses teks:`, // 2
            `[PERINTAH] [LOG] tidak terdapat perintah pada teks:`, // 3
            `[PERINTAH] [LOG] tidak ditemukan perintah:`, // 4
            `[PERINTAH] [LOG] mengirim pesan ke proses utama`, // 5
            `[PERINTAH] [ERROR] terjadi kesalahan saat menjalankan perintah:`, // 6
            `[PERINTAH] [LOG] memulai ulang proses`, // 7
        ][kode],
        ...argumen2
    );
}

if (argv.watch) {
    require('fs').watch(__filename, () => {
        log(7);
        process.exit();
    });
}
