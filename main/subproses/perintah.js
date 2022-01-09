const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const util = require('util');
const _ = require('lodash');
const fetch = require('node-fetch');

//////////////////// VARS

const argv = JSON.parse(process.argv[2]);
const $teks = {};

for (const file of fs.readdirSync('./res/teks')) {
    $teks[file.replace('.json', '')] = JSON.parse(fs.readFileSync('./res/teks/' + file));
    log(5, file);
}

log(0, Object.keys($teks));

const DBCache = { users: [], chats: [] };

//////////////////// UTAMA

async function pesanMasuk($pesan) {
    log(1, $pesan);
    const pesan = $pesan._;
    pesan.bahasa = 'id';

    if (/^[\/\-\\><+_=|~!?@#$%^&.]/.test(pesan.teks)) {
        const _perintah = pesan.teks.split(/\s+/)[0];

        pesan.argumen = pesan.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
        pesan.perintah = _perintah.slice(1).toLowerCase();

        log(2, pesan.teks);

        if (Perintah.hasOwnProperty(pesan.perintah)) {
            try {
                const hasil = {
                    penerima: pesan.pengirim,
                    ...(await Perintah[pesan.perintah](pesan)),
                };
                log(5, hasil);
                return IPC.kirimSinyal($pesan.d, hasil);
            } catch (e) {
                log(6, pesan.teks);
                console.error(e);
                return IPC.kirimSinyal($pesan.d, {
                    penerima: pesan.pengirim,
                    teks: $teks[pesan.bahasa]['system/error'],
                });
            }
        } else {
            log(4, pesan.perintah);
        }
    } else {
        log(3, pesan.teks);
    }
}

//////////////////// PERINTAH-PERINTAH

const Perintah = {
    about: (pesan) => {
        return {
            teks: $teks[pesan.bahasa]['command/about'],
        };
    },
    eval: async (pesan) => {
        if (!cekDev(pesan.uid)) {
            return { teks: $teks[pesan.bahasa]['permission/onlydev'] };
        }
        if (!pesan.argumen) {
            return { teks: $teks[pesan.bahasa]['command/eval/noargs'] };
        }
        let hasil;
        try {
            hasil = await eval(pesan.argumen);
        } catch (eror) {
            hasil = eror.stack ?? eror;
        } finally {
            return { teks: util.format(hasil) };
        }
    },
    help: () => Perintah.menu(),
    kbbi: async (pesan) => {
        if (pesan.argumen) {
            try {
                const f = await fetch('https://kateglo.com/api.php?format=json&phrase=' + encodeURIComponent(pesan.argumen.trim()));
                const res = (await f.json()).kateglo;
                const kata = res.phrase ? res.phrase.toUpperCase() : res.phrase;
                const akar = res.root[0] ? res.root.map((v) => v.root_phrase).join(' -> ') : '';
                const kelasLeksikal =
                    res.lex_class_name || res.lex_class_ref
                        ? (res.lex_class_name || res.lex_class_ref).toLowerCase()
                        : res.lex_class_name || res.lex_class_ref;
                let definisi = '';
                (res.definition || []).forEach((v, i) => {
                    let teks = `\n${v.def_num || i + 1}. ${v.discipline ? `[${v.discipline}] ` : ''}${v.def_text}`;
                    if (v.sample) teks += `\n=> ${v.sample}`;
                    if (v.see) teks += `\n${$teks[pesan.bahasa]['command/kbbi/seealso']}: ${v.see}`;
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
                    peribahasa += `\n• ${v.proverb}\n${$teks[pesan.bahasa]['command/kbbi/meaning']}: ${v.meaning}`;
                });
                const others = [
                    sinonim ? `${$teks[pesan.bahasa]['command/kbbi/synonyms']}: ${sinonim.trim()}` : '',
                    antonim ? `${$teks[pesan.bahasa]['command/kbbi/antonyms']}: ${antonim.trim()}` : '',
                    terkait ? `${$teks[pesan.bahasa]['command/kbbi/related']}: ${terkait.trim()}` : '',
                    kataTurunan ? `${$teks[pesan.bahasa]['command/kbbi/descendants']}: ${kataTurunan.trim()}` : '',
                    gabunganKata ? `${$teks[pesan.bahasa]['command/kbbi/combinations']}: ${gabunganKata.trim()}` : '',
                    peribahasa ? `${$teks[pesan.bahasa]['command/kbbi/proverbs']}:\n${peribahasa.trim()}` : '',
                    translasi ? `${$teks[pesan.bahasa]['command/kbbi/translations']}:\n${translasi.trim()}` : '',
                ]
                    .filter((v) => v)
                    .join('\n\n');
                return {
                    teks: `${akar ? `${akar} -> ` : ''}${kata} [${kelasLeksikal}]\n\n\n${definisi.trim()}\n\n${others}`,
                };
            } catch (eror) {
                return {
                    teks: $teks[pesan.bahasa]['command/kbbi/error'] + '\n\n' + String(eror),
                };
            }
        } else {
            return {
                teks: $teks[pesan.bahasa]['command/kbbi/noargs'],
            };
        }
    },
    lowercase: (pesan) => {
        if (pesan.argumen) {
            return {
                teks: pesan.argumen.toLowerCase(),
            };
        } else {
            return {
                teks: $teks[pesan.bahasa]['command/lowercase/noargs'],
            };
        }
    },
    menu: () => {
        return {
            teks: Object.keys(Perintah)
                .map((v) => '/' + v)
                .join('\n'),
        };
    },
    reversetext: (pesan) => {
        if (pesan.argumen) {
            return {
                teks: _.split(pesan.argumen, '').reverse().join(''),
            };
        } else {
            return {
                teks: $teks[pesan.bahasa]['command/reversetext/noargs'],
            };
        }
    },
    say: (pesan) => {
        return {
            teks: pesan.argumen,
        };
    },
    uppercase: (pesan) => {
        if (pesan.argumen) {
            return {
                teks: pesan.argumen.toUpperCase(),
            };
        } else {
            return {
                teks: $teks[pesan.bahasa]['command/uppercase/noargs'],
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

function kueriDB(koleksi, ...aksi) {
    return IPC.kirimKueri('DB', {
        koleksi: koleksi,
        aksi: aksi,
    });
}

////////////////////

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('_')) {
        if (pesan._.hasOwnProperty('pengirim')) {
            return await IPC.terimaSinyal(pesan, pesanMasuk);
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
        ][kode],
        ...argumen2
    );
}
