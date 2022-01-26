const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const cp = require('child_process');
const util = require('util');
const _ = require('lodash');
const fetch = require('node-fetch');
const chalk = require('chalk');
const gif = require('../alat/gif_konversi');
const webp = require('../alat/webp_konversi');

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

if (!fs.existsSync('./data/tmpdb.json')) fs.writeFileSync('./data/tmpdb.json', '{}');
cache.data = JSON.parse(fs.readFileSync('./data/tmpdb.json'));
setInterval(() => fs.writeFileSync('./data/tmpdb.json', JSON.stringify(cache.data)), 60000);

//////////////////// UTAMA

async function proses(pesan) {
    log(1, pesan);
    logPesan(pesan.d, pesan._);
    const c = (await DB.cari({ _id: pesan._.pengirim })).hasil;
    const data = {
        c: c,
        u: pesan._.pengirim !== pesan._.uid ? (await DB.cari({ _id: pesan._.uid })).hasil : c,
    };

    pesan._.bahasa = data.c?.lang || 'en';

    ////////// ANONYMOUS CHAT
    if (!pesan._.pengirim.endsWith('#C') && cache.data.anch?.active?.includes?.(pesan._.uid)) {
        anch(pesan, data);
    }
    ////////// PERINTAH
    else if (pesan._.teks) {
        if (/^[\/\-\\><+_=|~!?@#$%^&.]/.test(pesan._.teks)) {
            perintah(pesan, data);
        } else {
            log(3, pesan._.teks);
        }
    }
}

//////////////////// ANONYMOUS CHAT

async function anch(pesan, data) {
    const $ = pesan._;
    for (const roomID in cache.data.anch.room) {
        const room = cache.data.anch.room[roomID];
        const partner = room[$.uid];
        if (!partner) continue;

        if (!room.chat) room.chat = [];
        if (pesan.d === 'WA') {
            IPC.kirimSinyal('WA', {
                anch: {
                    roomID: roomID,
                    msgID: $.mid,
                },
            });
        }
        if (/^[\/\-\\><+_=|~!?@#$%^&.]/.test($.teks)) {
            const cmd = $.teks.slice(1).toLowerCase();
            console.log(cmd);
            if (cmd === 'anext') {
                delete cache.data.anch.room[roomID];
                _.pull(cache.data.anch.active, $.uid, partner);
                kirimPesan(partner, { teks: TEKS[$.bahasa]['anonymouschat/partnerstoppeddialog'] });
                if (cache.data.anch.ready?.length) {
                    const partnerID = _.sample(cache.data.anch.ready);
                    _.pull(cache.data.anch.ready, partnerID);
                    if (pesan.d === 'WA') {
                        IPC.kirimSinyal('WA', {
                            anch: {
                                delRoomID: roomID,
                            },
                        });
                    }
                    const newRoomID = Math.random().toString(36).slice(2);
                    cache.data.anch.room[newRoomID] = {
                        [$.uid]: partnerID,
                        [partnerID]: $.uid,
                    };
                    cache.data.anch.active.push($.uid, partnerID);
                    kirimPesan(partnerID, { teks: TEKS[$.bahasa]['anonymouschat/partnerfound'] });
                    kirimPesan($.uid, { teks: TEKS[$.bahasa]['anonymouschat/partnerfound'] });
                } else {
                    if (!cache.data.anch.ready) cache.data.anch.ready = [];
                    cache.data.anch.ready.push($.uid);
                    kirimPesan($.uid, { teks: TEKS[$.bahasa]['anonymouschat/findingpartner'] });
                }
                return;
            } else if (cmd === 'astop') {
                delete cache.data.anch.room[roomID];
                _.pull(cache.data.anch.active, $.uid, partner);
                if (pesan.d === 'WA') {
                    IPC.kirimSinyal('WA', {
                        anch: {
                            delRoomID: roomID,
                        },
                    });
                }
                kirimPesan($.uid, { teks: TEKS[$.bahasa]['anonymouschat/stoppingdialog'] });
                kirimPesan(partner, { teks: TEKS[$.bahasa]['anonymouschat/partnerstoppeddialog'] });
                return;
            }
        }

        let msg = {
            anch: {
                roomID: roomID,
            },
            re: $.q ? room.chat.filter((v) => v.includes($.q.mid))[0]?.filter?.((v) => v !== $.q.mid)?.[0] : undefined,
        };

        ////////////////////
        if ($.uid.startsWith('WA')) {
            if (partner.startsWith('WA')) {
                msg.copy = {
                    roomID: roomID,
                    msgID: $.mid,
                };
            } else if (partner.startsWith('TG')) {
                if ($.gambar) {
                    const file = await IPC.kirimKueri('WA', { unduh: $.gambar });
                    msg.gambar = { file: file.file };
                    msg.teks = $.teks;
                } else if ($.video) {
                    const file = await IPC.kirimKueri('WA', { unduh: $.video });
                    msg.video = { file: file.file };
                    msg.teks = $.teks;
                } else if ($.stiker) {
                    const file = await IPC.kirimKueri('WA', { unduh: $.stiker });
                    if ($.stiker.animasi) {
                        const gif = await webp.keGif(file.file);
                        msg.video = {
                            file: gif,
                            gif: true,
                        };
                    } else {
                        msg.stiker = { file: file.file };
                    }
                } else if ($.lokasi) {
                    msg.lokasi = $.lokasi;
                } else if ($.audio) {
                    const file = await IPC.kirimKueri('WA', { unduh: $.audio });
                    msg.audio = { file: file.file };
                } else if ($.dokumen) {
                    const file = await IPC.kirimKueri('WA', { unduh: $.dokumen });
                    msg.dokumen = { file: file.file, mimetype: $.dokumen.mimetype, namaFile: $.dokumen.namaFile };
                    msg.teks = `[[ ${$.dokumen.namaFile} ]]`;
                } else if ($.kontak) {
                    msg.kontak = $.kontak;
                } else {
                    if ($.teks) {
                        msg.teks = $.teks;
                    } else {
                        msg.teks = TEKS[$.bahasa]['anonymouschat/messagenotsupported'];
                    }
                }
            }
        }

        ////////////////////
        else if ($.uid.startsWith('TG')) {
            if (partner.startsWith('TG')) {
                msg.copy = {
                    from: $.uid,
                    mid: $.mid,
                };
            } else if (partner.startsWith('WA')) {
                if ($.gambar) {
                    const file = await IPC.kirimKueri('TG', { unduh: $.gambar });
                    msg.gambar = { file: file.file };
                    msg.teks = $.teks;
                } else if ($.video) {
                    const file = await IPC.kirimKueri('TG', { unduh: $.video });
                    msg.video = { file: file.file };
                    msg.teks = $.teks;
                } else if ($.stiker) {
                    const file = await IPC.kirimKueri('TG', { unduh: $.stiker });
                    msg.stiker = { file: file.file };
                } else if ($.lokasi) {
                    msg.lokasi = $.lokasi;
                } else if ($.audio) {
                    const file = await IPC.kirimKueri('TG', { unduh: $.audio });
                    msg.audio = { file: file.file };
                    msg.teks = $.teks;
                } else if ($.dokumen) {
                    const file = await IPC.kirimKueri('TG', { unduh: $.dokumen });
                    msg.dokumen = {
                        file: file.file,
                        mimetype: $.dokumen.mimetype,
                        namaFile: $.dokumen.namaFile,
                    };
                    msg.teks = $.teks;
                } else if ($.kontak) {
                    msg.kontak = $.kontak;
                } else {
                    if ($.teks) {
                        msg.teks = $.teks;
                    } else {
                        msg.teks = TEKS[$.bahasa]['anonymouschat/messagenotsupported'];
                    }
                }
            }
        }

        const terkirim = await _kirimPesan(partner, msg);

        if (terkirim.s) {
            if (Array.isArray(terkirim.mid)) {
                terkirim.mid.forEach((mid) => room.chat.push([$.mid, mid]));
            } else {
                room.chat.push([$.mid, terkirim.mid]);
            }
        } else {
            kirimPesan($.uid, TEKS[$.bahasa]['anonymouschat/sendingfailed']);
        }
        break;
    }
}

//////////////////// VALIDASI
async function validasiGrup(bahasa, data) {
    if (!data.c) return { teks: TEKS[bahasa]['group/notregistered'] };
    if (Date.now() > +data.c.expiration) return { teks: TEKS[bahasa]['group/expired'] };
    else return false;
}

async function validasiUser(bahasa, uid, data) {
    let r = false;
    if (!cache.data.cdcmd) cache.data.cdcmd = {};
    const cdcmd = cache.data.cdcmd;
    if (!cdcmd[uid]) cdcmd[uid] = 0;
    console.log(cdcmd, data.u);
    if (!data.u || data.u.premlvl === 0 || Date.now() > +data.u.expiration) {
        // FREE USER
        if (Date.now() - cdcmd[uid] < 5000) r = { teks: TEKS[bahasa]['user/freeusercdcommandreached'].replace('%lvl', 'Free User').replace('%dur', '5') };
    } else {
        if (data.u.premlvl === 1) {
            // PREMIUM LITE
            if (Date.now() - cdcmd[uid] < 1500) r = { teks: TEKS[bahasa]['user/cdcommandreached'].replace('%lvl', 'Premium Lite').replace('%dur', '1.5') };
        } else if (data.u.premlvl === 2) {
            // PREMIUM XTREME
        }
    }
    cdcmd[uid] = Date.now();
    return r;
}

//////////////////// PERINTAH-PERINTAH

async function perintah(pesan, data) {
    const $ = pesan._;
    const _perintah = $.teks.split(/\s+/)[0];
    $.platform = pesan.d;

    $.argumen = $.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
    $.perintah = _perintah.slice(1).toLowerCase();
    $.arg = $.argumen || $.q?.teks || '';

    log(2, $.teks);
    if ($.perintah === 'getid') return kirimPesan($.pengirim, { teks: $.pengirim, re: true, mid: $.mid });
    if ($.perintah === 'getuid') return kirimPesan($.pengirim, { teks: $.uid, re: true, mid: $.mid });
    if ($.perintah === 'pricing') return kirimPesan($.pengirim, { teks: TEKS[$.bahasa]['command/pricing'], re: true, mid: $.mid });

    if (Perintah.hasOwnProperty($.perintah)) {
        let r;
        if ($.pengirim.endsWith('#C') && (r = await validasiGrup($.bahasa, data))) return kirimPesan($.pengirim, r);
        if ((r = await validasiUser($.bahasa, $.uid, data))) return kirimPesan($.pengirim, { ...r, re: true, mid: $.mid });

        const msg = {
            penerima: $.pengirim,
            mid: $.mid,
            re: true,
        };
        try {
            const hasil = {
                ...msg,
                ...(await Perintah[$.perintah]($, data)),
            };
            log(5, hasil);
            logPesan(pesan.d, hasil, true);
            return kirimPesan($.pengirim, hasil);
        } catch (e) {
            log(6, $.teks);
            console.error(e);
            const hasil = {
                ...msg,
                teks: TEKS[$.bahasa]['system/error'].replace('%e', e),
            };
            logPesan(pesan.d, hasil, true);
            return kirimPesan($.pengirim, hasil);
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
    setgroupsubscription: async ($) => {
        if (!cekDev($.uid)) return { teks: TEKS[$.bahasa]['permission/devonly'] };
        let [id, durasi] = $.argumen.split(/\s+/),
            perpanjang = false;
        if (!id) return { teks: TEKS[$.bahasa]['command/setgroupsubscription/noid'] };
        if (durasi.startsWith('+')) {
            perpanjang = true;
            durasi = durasi.slice(1);
        }
        if (isNaN(+durasi)) return { teks: TEKS[$.bahasa]['command/setgroupsubscription/invalidduration'] };
        let e;
        const cdata = (await DB.cari({ _id: id })).hasil;
        if (cdata) e = await DB.perbarui({ _id: id }, { $set: { expiration: perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi } });
        else e = await DB.buat({ _id: id, join: Date.now(), expiration: Date.now() + +durasi });
        if (e._e) throw e._e;
        return {
            teks: TEKS[$.bahasa]['command/setgroupsubscription/done']
                .replace('%id', id)
                .replace('%date', new Date(perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi)),
        };
    },
    anext: ($) => {
        return { teks: TEKS[$.bahasa]['anonymouschat/notinanyroom'] };
    },
    asearch: async ($, data) => {
        if ($.pengirim.endsWith('#C')) return { teks: TEKS[$.bahasa]['permission/privateonly'] };
        if (cache.data.anch?.ready?.length) {
            const partnerID = _.sample(cache.data.anch.ready);
            _.pull(cache.data.anch.ready, partnerID);
            const roomID = Math.random().toString(36).slice(2);
            if (!cache.data.anch.room) cache.data.anch.room = {};
            cache.data.anch.room[roomID] = {
                [$.uid]: partnerID,
                [partnerID]: $.uid,
            };
            if (!cache.data.anch.active) cache.data.anch.active = [];
            cache.data.anch.active.push($.uid, partnerID);
            kirimPesan(partnerID, { teks: TEKS[$.bahasa]['anonymouschat/partnerfound'] });
            return { teks: TEKS[$.bahasa]['anonymouschat/partnerfound'] };
        } else {
            if (!cache.data.anch) cache.data.anch = {};
            if (!cache.data.anch.ready) cache.data.anch.ready = [];
            cache.data.anch.ready.push($.uid);
            return { teks: TEKS[$.bahasa]['anonymouschat/findingpartner'] };
        }
    },
    astop: ($) => {
        if (cache.data.anch?.ready?.includes?.($.uid)) {
            _.pull(cache.data.anch.ready, $.uid);
            return { teks: TEKS[$.bahasa]['anonymouschat/findingpartnercancelled'] };
        }
        return { teks: TEKS[$.bahasa]['anonymouschat/notinanyroom'] };
    },
    convert: async ($) => {
        const Format = {
            mp3: async () => {
                const media = $.video || $.dokumen || $.audio || $.q?.video || $.q?.dokumen || $.q?.audio;
                if (!media) return { teks: TEKS[$.bahasa]['command/convert/mp3/notsupported'] };
                const { file, _e } = await unduh($.pengirim, media);
                if (_e) throw _e;
                const output = await new Promise((resolve, reject) => {
                    const out = `./tmp/${utils.namaFileAcak()}.mp3`;
                    cp.exec(`ffmpeg -i ${file} ${out}`, (eror) => {
                        if (eror) return reject(eror);
                        resolve(out);
                    });
                });
                return { dokumen: { file: output, mimetype: 'audio/mp3', namaFile: media.namaFile ? media.namaFile + '.mp3' : output.replace('./tmp/', '') } };
            },
        };

        if (!$.argumen)
            return {
                teks: TEKS[$.bahasa]['command/convert/noargs'].replace(
                    '%formats',
                    Object.keys(Format)
                        .map((v) => '/convert ' + v)
                        .join('\n')
                ),
            };
        const format = $.argumen.trim().toLowerCase();
        if (Format.hasOwnProperty(format)) {
            return await Format[format]();
        } else {
            return {
                teks: TEKS[$.bahasa]['command/convert/unknownformat'].replace(
                    '%formats',
                    Object.keys(Format)
                        .map((v) => '/convert ' + v)
                        .join('\n')
                ),
            };
        }
    },
    eval: async ($) => {
        if (!cekDev($.uid)) {
            return {
                teks: TEKS[$.bahasa]['permission/devonly'],
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
    getid: () => {},
    getuid: () => {},
    help: ($) => Perintah.menu($),
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
    pricing: () => {},
    register: async ($, data) => {
        if (data.u) return { teks: TEKS[$.bahasa]['command/register/alreadyregistered'] };
        if (!$.argumen) return { teks: TEKS[$.bahasa]['command/register/noargs'] };
        const { _e } = await DB.buat({
            _id: $.uid,
            join: Date.now(),
            name: $.argumen,
        });
        if (_e) throw _e;
        return { teks: TEKS[$.bahasa]['command/register/done'].replace('%name', $.argumen).replace('%id', $.uid).replace('%date', new Date().toString()) };
    },
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
    set: async ($, data) => {
        if (!data.u) return { teks: TEKS[$.bahasa]['permission/registeredonly'] };
        const args = $.argumen.split(/\s+/);
        const argumen = $.argumen.replace(new RegExp(`^${_.escapeRegExp(args[0])}\\s*`), '');

        const Settings = {
            lang: async () => {
                if ($.pengirim.endsWith('#C')) {
                    if (!(await IPC.kirimKueri($.platform, { isAdmin: { c: $.pengirim, u: $.uid } })).admin) return { teks: TEKS[$.bahasa]['permission/adminonly'] };
                }
                const langs = Object.keys(TEKS);
                if (!args[1]) return { teks: TEKS[$.bahasa]['command/set/lang/noargs'].replace('%langs', langs.join(', ')) };
                args[1] = args[1].toLowerCase();
                if (!langs.includes(args[1]))
                    return { teks: TEKS[$.bahasa]['command/set/lang/unknownlanguage'].replace('%langs', langs.join(', ')).replace('%lang', args[1]) };
                const { _e } = await DB.perbarui({ _id: $.pengirim.endsWith('#C') ? $.pengirim : $.uid }, { $set: { lang: args[1] } });
                if (_e) throw _e;
                return { teks: TEKS[args[1]]['command/set/lang/done'].replace('%lang', args[1]) };
            },
            name: async () => {
                if (!argumen) return { teks: TEKS[$.bahasa]['command/set/name/noargs'] };
                const { _e } = await DB.perbarui({ _id: $.uid }, { $set: { name: argumen } });
                if (_e) throw _e;
                return { teks: TEKS[$.bahasa]['command/set/name/done'].replace('%old', data.u.name).replace('%new', argumen) };
            },
        };

        if (!args[0])
            return {
                teks: TEKS[$.bahasa]['command/set/noargs'].replace(
                    '%list',
                    Object.keys(Settings)
                        .map((v) => '/set ' + v)
                        .join('\n')
                ),
            };
        args[0] = args[0].toLowerCase();
        if (Settings.hasOwnProperty(args[0])) {
            return await Settings[args[0]]();
        } else {
            return {
                teks: TEKS[$.bahasa]['command/set/unknownsetting'].replace('%set', args[0]).replace(
                    '%list',
                    Object.keys(Settings)
                        .map((v) => '/set ' + v)
                        .join('\n')
                ),
            };
        }
    },
    setpremiumuser: async ($) => {
        if (!cekDev($.uid)) return { teks: TEKS[$.bahasa]['permission/devonly'] };
        let [id, level, durasi] = $.argumen.split(/\s+/),
            perpanjang = false;
        if (!id) return { teks: TEKS[$.bahasa]['command/setpremiumuser/noid'] };
        if (isNaN(+level) || +level < 0 || +level > 2) return { teks: TEKS[$.bahasa]['command/setpremiumuser/invalidlevel'] };
        if (durasi?.startsWith?.('+')) {
            perpanjang = true;
            durasi = durasi.slice(1);
        }
        if (+level !== 0 && isNaN(+durasi)) return { teks: TEKS[$.bahasa]['command/setpremiumuser/invalidduration'] };
        const udata = (await DB.cari({ _id: id })).hasil;
        let e;
        if (udata) e = await DB.perbarui({ _id: id }, { $set: { premlvl: +level, expiration: perpanjang ? udata.expiration + +durasi : Date.now() + +durasi } });
        else if (+level) e = await DB.buat({ _id: id, premlvl: +level, expiration: Date.now() + +durasi });
        if (e._e) throw e._e;
        const namaLvl = ['Free User', 'Premium Lite', 'Premium Xtreme'][+level];
        if (+level)
            return {
                teks: TEKS[$.bahasa]['command/setpremiumuser/done']
                    .replace('%id', id)
                    .replace('%lvl', namaLvl)
                    .replace('%date', new Date(perpanjang ? udata.expiration + +durasi : Date.now() + +durasi)),
            };
        return {
            teks: TEKS[$.bahasa]['command/setpremiumuser/doneremove']
                .replace('%id', id)
                .replace('%lvl', namaLvl)
                .replace('%date', new Date(perpanjang ? udata.expiration + +durasi : Date.now() + +durasi)),
        };
    },
    sticker: async ($, data) => {
        if (!$.pengirim.startsWith('WA#')) return { teks: TEKS[$.bahasa]['command/sticker/onlywhatsapp'] };
        if ($.gambar || $.q?.gambar) {
            const gambar = $.gambar || $.q?.gambar;
            if (gambar.ukuran > 1000000) return { teks: TEKS[$.bahasa]['command/sticker/sizetoolarge'] };
            const { file, _e } = await unduh($.pengirim, gambar);
            if (_e) throw _e;
            let _webp = await webp.keWebp(file, 'jpg');
            _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
            return { stiker: { file: _webp } };
        } else if ($.video || $.q?.video) {
            const video = $.video || $.q?.video;
            if (video.ukuran > 1000000) return { teks: TEKS[$.bahasa]['command/sticker/sizetoolarge'] };
            const { file, _e } = await unduh($.pengirim, video);
            if (_e) throw _e;
            let _webp = await webp.keWebp(file, 'mp4');
            _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
            return { stiker: { file: _webp } };
        } else if ($.dokumen || $.q?.dokumen) {
            const dokumen = $.dokumen || $.q?.dokumen;
            if (dokumen.ukuran > 1000000) return { teks: TEKS[$.bahasa]['command/sticker/sizetoolarge'] };
            if (!['jpg', 'png', 'gif', 'mp4', 'webp', 'mpeg', 'avi', 'ogv', 'webm', '3gp'].includes(dokumen.eks))
                return { teks: TEKS[$.bahasa]['command/sticker/documentnotsupported'] };
            const { file, _e } = await unduh($.pengirim, dokumen);
            if (_e) throw _e;
            let _webp = await webp.keWebp(file, dokumen.eks);
            _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
            return { stiker: { file: _webp } };
        } else {
            return { teks: TEKS[$.bahasa]['command/sticker/medianotsupported'] };
        }
    },
    unsticker: async ($) => {
        const stiker = $.stiker || $.q?.stiker;
        if (stiker.animasi) {
            if ($.pengirim.startsWith('TG#')) return { teks: TEKS[$.bahasa]['command/unsticker/animatedstickertelegramnotsupported'] };
            const { file, _e } = await unduh($.pengirim, stiker);
            if (_e) throw _e;
            let output = await webp.keGif(file);
            output = await gif.keMp4(output);
            return { video: { file: output, gif: true } };
        } else {
            const { file, _e } = await unduh($.pengirim, stiker);
            if (_e) throw _e;
            const output = await webp.kePng(file);
            return { gambar: { file: output } };
        }
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

function unduh(penerima, media) {
    return IPC.kirimKueri(penerima.split('#')[0], {
        unduh: media,
    });
}

function kirimPesan(penerima, pesan) {
    return IPC.kirimSinyal(penerima.split('#')[0], {
        penerima: penerima,
        ...pesan,
    });
}

function _kirimPesan(penerima, pesan) {
    return IPC.kirimKueri(penerima.split('#')[0], {
        penerima: penerima,
        ...pesan,
    });
}

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
    return console.log(
        new Date().toLocaleDateString(),
        new Date().toLocaleTimeString(),
        chalk.cyan(`<${d.toUpperCase()}>`),
        id.join(':'),
        chalk.cyan(
            `[${
                pesan.gambar
                    ? 'gambar'
                    : pesan.stiker
                    ? 'stiker'
                    : pesan.video
                    ? 'video'
                    : pesan.audio
                    ? 'audio'
                    : pesan.lokasi
                    ? 'lokasi'
                    : pesan.dokumen
                    ? 'dokumen'
                    : pesan.kontak
                    ? 'kontak'
                    : ''
            }]`
        ),
        pesan.teks || ''
    );
}

////////////////////

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('_')) {
        if (pesan._.hasOwnProperty('pengirim')) {
            return await IPC.terimaSinyal(pesan, proses);
        }
    }
});

process.on('exit', () => fs.writeFileSync('./data/tmpdb.json', JSON.stringify(cache.data)));

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
