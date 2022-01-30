const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const fsp = require('fs/promises');
const cp = require('child_process');
const util = require('util');
const _ = require('lodash');
const fetch = require('node-fetch');
const chalk = require('chalk');
const FormData = require('form-data');
const mimetypes = require('mime-types');
const gif = require('../alat/gif_konversi');
const webp = require('../alat/webp_konversi');

//////////////////// VARS

const pid = Math.random().toString(36).slice(2);
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

    const $ = pesan._;
    $.platform = pesan.d;
    $.bahasa = data.c?.lang || 'en';

    $.TEKS = (teks) => TEKS[$.bahasa][teks];

    ////////// ANONYMOUS CHAT
    if (!$.pengirim.endsWith('#C') && cache.data.anch?.active?.includes?.($.uid)) {
        anch(pesan, data);
    }
    ////////// INPUT
    else if (cache.data.waiter && cache.data.waiter[$.uid] && cache.data.waiter[$.uid]._in === $.pengirim) {
        waiter($, data);
    }
    ////////// PERINTAH
    else if ($.teks && /^[\/\-\\><+_=|~!?@#$%^&\:.][a-zA-Z0-9]+\s*/.test($.teks)) {
        perintah(pesan, data);
    }

    ////////// SIMSIMI
    else if (cache.data.simsimi[$.pengirim]) {
        simsimi($, data);
    }
}

async function simsimi($, data) {
    if (cache.data.simsimi[$.pengirim].expiration < Date.now()) {
        delete cache.data.simsimi[$.pengirim];
        return;
    }
    if ($.teks && Math.random() > 0.25) {
        try {
            if ($.teks.length > 1096) {
                return kirimPesan($.pengirim, {
                    teks: $.TEKS('command/simsimi/texttoolong'),
                    re: true,
                    mid: $.mid,
                });
            }
            const res = await (await lolHumanAPI('simi', 'text=' + encodeURI($.teks))).json();
            if (res.status != 200 || !res.result) throw JSON.stringify(res);
            const { s, _e } = await new Promise((resolve) => {
                setTimeout(() => {
                    _kirimPesan($.pengirim, {
                        teks: res.result,
                        re: true,
                        mid: $.mid,
                    }).then((v) => resolve(v));
                }, _.random(0, 5000));
            });
            if (s === false) throw _e;
        } catch (e) {
            const errId = Math.random().toString(36).slice(2).toUpperCase();
            cache.data.errors ||= {};
            cache.data.errors[errId] = {
                $: $,
                e: e?.stack ?? e,
                t: Date.now(),
            };
            kirimPesan($.pengirim, {
                teks: $.TEKS('command/simsimi/error').replace('%err', errId),
                re: true,
                mid: $.mid,
            });
        }
    }
    // else {
    //     kirimPesan($.pengirim, {
    //         teks: $.TEKS('command/simsimi/notext'),
    //         re: true,
    //         mid: $.mid,
    //     });
    // }
}

async function waiter($, data) {
    try {
        const waiter = cekWaiter($);
        const handler = waiter.val._handler;
        let r,
            i = 0;
        do {
            if (!r) r = Perintah[handler[i++]];
            else r = r._[handler[i++]];
        } while (!r.hd);
        if (r.hd) {
            if ($.teks && /^[\/\-\\><+_=|~!?@#$%^&\:.][a-zA-Z0-9]+\s*/.test($.teks)) {
                const _perintah = $.teks.split(/\s+/)[0];
                $.argumen = $.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
                $.perintah = _perintah.slice(1).toLowerCase();
                $.arg = $.argumen || $.q?.teks || '';
                $.args = $.argumen.split(/\s+/);
            }
            r = await r.hd(waiter, $, data);
            if (!r) return;
            let lim;
            if (r._limit) {
                lim = r._limit;
                delete r._limit;
            }
            const { s, _e } = await _kirimPesan($.pengirim, { ...r, re: true, mid: $.mid });
            if (s === false) throw _e;
            if (lim) lim.kurangi();
        }
    } catch (e) {
        log(6, $.teks);
        console.error(e);
        const errId = Math.random().toString(36).slice(2).toUpperCase();
        cache.data.errors ||= {};
        cache.data.errors[errId] = {
            $: $,
            e: e?.stack ?? e,
            t: Date.now(),
        };
        const hasil = {
            re: true,
            mid: $.mid,
            teks: $.TEKS('system/error').replace('%e', errId),
        };
        kirimPesan($.pengirim, hasil);
        for (const id in cache.data.errors) {
            if (Date.now() - cache.data.errors[id].t > 86_400_000) delete cache.data.errors[id];
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
                kirimPesan(partner, { teks: $.TEKS('anonymouschat/partnerstoppeddialog') });
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
                    kirimPesan(partnerID, { teks: $.TEKS('anonymouschat/partnerfound') });
                    kirimPesan($.uid, { teks: $.TEKS('anonymouschat/partnerfound') });
                } else {
                    if (!cache.data.anch.ready) cache.data.anch.ready = [];
                    cache.data.anch.ready.push($.uid);
                    kirimPesan($.uid, { teks: $.TEKS('anonymouschat/findingpartner') });
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
                kirimPesan($.uid, { teks: $.TEKS('anonymouschat/stoppingdialog') });
                kirimPesan(partner, { teks: $.TEKS('anonymouschat/partnerstoppeddialog') });
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
                        msg.teks = $.TEKS('anonymouschat/messagenotsupported');
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
                        msg.teks = $.TEKS('anonymouschat/messagenotsupported');
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
            kirimPesan($.uid, $.TEKS('anonymouschat/sendingfailed'));
        }
        break;
    }
}

//////////////////// VALIDASI
async function validasiGrup($, data) {
    if (!data.c) return { teks: $.TEKS('group/notregistered') };
    if (Date.now() > +data.c.expiration) return { teks: $.TEKS('group/expired') };
    else return false;
}

async function validasiUser($, data) {
    let r = false;
    if (!cache.data.cdcmd) cache.data.cdcmd = {};
    const cdcmd = cache.data.cdcmd;
    if (!cdcmd[$.uid]) cdcmd[$.uid] = 0;
    if (!data.u || data.u.premlvl === 0 || Date.now() > data.u.expiration) {
        // FREE USER
        if (Date.now() - cdcmd[$.uid] < 5000) r = { teks: $.TEKS('user/freeusercdcommandreached').replace('%lvl', 'Free User').replace('%dur', '5') };
    } else {
        if (data.u.premlvl === 1) {
            // PREMIUM LITE
            if (Date.now() - cdcmd[$.uid] < 1500) r = { teks: $.TEKS('user/cdcommandreached').replace('%lvl', 'Premium Lite').replace('%dur', '1.5') };
        } else if (data.u.premlvl === 2) {
            // PREMIUM XTREME
        }
    }
    cdcmd[$.uid] = Date.now();
    return r;
}

function cekLimit($, data) {
    const now = Date.now();
    if (!cache.data.usrlimit) cache.data.usrlimit = { update: now };
    const usrlimit = cache.data.usrlimit;
    if (usrlimit.update < now - (now % 86_400_000)) cache.data.usrlimit = { update: now };
    return {
        val: cekPremium($, data) ? Infinity : usrlimit[$.uid] ?? (usrlimit[$.uid] = 1),
        kurangi: () => {
            if (data.u?.premlvl === 0 && usrlimit[$.uid] > 0) {
                usrlimit[$.uid] -= 1;
                return kirimPesan($.pengirim, { teks: $.TEKS('user/limitnotice').replace('%lim', usrlimit[$.uid]), re: true, mid: $.mid });
            }
        },
        habis: { teks: $.TEKS('user/limitreached') },
    };
}

function cekWaiter($) {
    cache.data.waiter ||= {};
    return {
        val: cache.data.waiter[$.uid],
        tolak: () => ({
            teks: cache.data.waiter[$.uid]
                ? $.TEKS('user/inanothersession').replace('%session', cache.data.waiter[$.uid]._sessionName || cache.data.waiter[$.uid]._handler.join('-'))
                : '',
        }),
        tambahkan: (_in, _handler, data) =>
            (cache.data.waiter[$.uid] = {
                _in: _in,
                _handler: _handler,
                ...data,
            }),
        hapus: () => delete cache.data.waiter[$.uid],
        notice: (cmd, d) => ({
            teks: $.TEKS('user/dialognotice').replace('%cmd', cmd).replace('%d', d),
        }),
    };
}

function cekPremium($, data) {
    if (data.u?.premlvl) {
        console.log(true);
        if (data.u.expiration > Date.now()) return true;
        return false;
    }
    return false;
}

//////////////////// PERINTAH-PERINTAH

async function perintah(pesan, data) {
    const $ = pesan._;
    $.platform = pesan.d;
    const _perintah = $.teks.split(/\s+/)[0];
    $.argumen = $.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
    $.perintah = _perintah.slice(1).toLowerCase();
    $.arg = $.argumen || $.q?.teks || '';
    $.args = $.argumen.split(/\s+/);

    log(2, $.teks);
    if ($.perintah === 'getid') return kirimPesan($.pengirim, { teks: $.pengirim, re: true, mid: $.mid });
    if ($.perintah === 'getuid') return kirimPesan($.pengirim, { teks: $.uid, re: true, mid: $.mid });
    if ($.perintah === 'pricing') return kirimPesan($.pengirim, { teks: $.TEKS('command/pricing'), re: true, mid: $.mid });

    if (Perintah.hasOwnProperty($.perintah)) {
        let r;
        if ($.pengirim.endsWith('#C') && (r = await validasiGrup($, data))) return kirimPesan($.pengirim, r);
        if ((r = await validasiUser($, data))) return kirimPesan($.pengirim, { ...r, re: true, mid: $.mid });

        const msg = {
            penerima: $.pengirim,
            mid: $.mid,
            re: true,
        };
        try {
            const res = await Perintah[$.perintah].fn($, data);
            if (!res) return;
            let lim;
            if (res._limit) {
                lim = res._limit;
                delete res._limit;
            }
            const hasil = {
                ...msg,
                ...res,
            };
            log(5, hasil);
            logPesan(pesan.d, hasil, true);
            let { s, _e } = await _kirimPesan($.pengirim, hasil);
            if (s === false) throw _e || s;
            if (lim) lim.kurangi();
        } catch (e) {
            log(6, $.teks);
            console.error(e);
            const errId = Math.random().toString(36).slice(2).toUpperCase();
            cache.data.errors ||= {};
            cache.data.errors[errId] = {
                $: $,
                e: e?.stack ?? e,
                t: Date.now(),
            };
            const hasil = {
                ...msg,
                teks: $.TEKS('system/error').replace('%e', errId),
            };
            logPesan(pesan.d, hasil, true);
            kirimPesan($.pengirim, hasil);
            for (const id in cache.data.errors) {
                if (Date.now() - cache.data.errors[id].t > 86_400_000) delete cache.data.errors[id];
            }
        }
    } else {
        log(4, $.perintah);
        if (cache.data.simsimi[$.pengirim]) {
            simsimi($, data);
        }
    }
}

const Perintah = {
    about: {
        stx: '/about',
        cat: 'bot',
        fn: ($) => {
            return {
                teks: $.TEKS('command/about'),
            };
        },
    },
    setgroupsubscription: {
        stx: '/setgroupsubscription [id] [dur]',
        cat: 'dev',
        fn: async ($) => {
            if (!cekDev($.uid)) return { teks: $.TEKS('permission/devonly') };
            let [id, durasi] = $.argumen.split(/\s+/),
                perpanjang = false;
            if (!id) return { teks: $.TEKS('command/setgroupsubscription') };
            if (durasi.startsWith('+')) {
                perpanjang = true;
                durasi = durasi.slice(1);
            }
            if (durasi.endsWith('d')) {
                durasi = `${+durasi.slice(0, -1) * 86_400_000}`;
            }
            if (isNaN(+durasi)) return { teks: $.TEKS('command/setgroupsubscription') };
            let e;
            const cdata = (await DB.cari({ _id: id })).hasil;
            if (cdata) e = await DB.perbarui({ _id: id }, { $set: { expiration: perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi } });
            else e = await DB.buat({ _id: id, join: Date.now(), expiration: Date.now() + +durasi });
            if (e._e) throw e._e;
            kirimPesan(id, {
                teks: $.TEKS('command/setgroupsubscription/notify').replace(
                    '%date',
                    new Date(perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi).toLocaleString()
                ),
            });
            return {
                teks: $.TEKS('command/setgroupsubscription/done')
                    .replace('%id', id)
                    .replace('%date', new Date(perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi).toLocaleString()),
            };
        },
    },
    anext: {
        stx: '/anext',
        cat: 'anonymouschat',
        fn: ($) => {
            return { teks: $.TEKS('anonymouschat/notinanyroom') };
        },
    },
    asearch: {
        stx: '/asearch',
        cat: 'anonymouschat',
        fn: async ($) => {
            if ($.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/privateonly') };
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
                kirimPesan(partnerID, { teks: $.TEKS('anonymouschat/partnerfound') });
                return { teks: $.TEKS('anonymouschat/partnerfound') };
            } else {
                if (!cache.data.anch) cache.data.anch = {};
                if (!cache.data.anch.ready) cache.data.anch.ready = [];
                cache.data.anch.ready.push($.uid);
                return { teks: $.TEKS('anonymouschat/findingpartner') };
            }
        },
    },
    astop: {
        stx: '/astop',
        cat: 'anonymouschat',
        fn: ($) => {
            if (cache.data.anch?.ready?.includes?.($.uid)) {
                _.pull(cache.data.anch.ready, $.uid);
                return { teks: $.TEKS('anonymouschat/findingpartnercancelled') };
            }
            return { teks: $.TEKS('anonymouschat/notinanyroom') };
        },
    },
    audioonly: {
        stx: '/audioonly',
        cat: 'converter',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            let media;
            if ($.video || $.q?.video) {
                media = $.video || $.q?.video;
            } else if ($.dokumen || $.q?.dokumen) {
                media = $.dokumen || $.q?.dokumen;
                if (!['mp4', 'mpeg', 'avi', 'ogv', '3gp'].includes(media.eks)) return { teks: $.TEKS('command/audioonly/notsupported') };
            } else {
                return { teks: $.TEKS('command/audioonly/nomedia') };
            }
            const { file, _e } = await unduh($.pengirim, media);
            if (_e) throw _e;
            const output = await new Promise((resolve, reject) => {
                const out = `./tmp/${utils.namaFileAcak()}.mp3`;
                cp.exec(`ffmpeg -i ${file} ${out}`, (eror) => {
                    if (eror) return reject(eror);
                    resolve(out);
                });
            });
            return { dokumen: { file: output, mimetype: 'audio/mp3', namaFile: media.namaFile ? media.namaFile + '.mp3' : output.replace('./tmp/', '') }, _limit: limit };
        },
    },
    eval: {
        stx: '/eval [js]',
        cat: 'dev',
        fn: async ($, data) => {
            if (!cekDev($.uid)) {
                return {
                    teks: $.TEKS('permission/devonly'),
                };
            }
            if (!$.argumen) {
                return {
                    teks: $.TEKS('command/eval'),
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
    },
    asahotak: {
        stx: '/asahotak (Indonesia)',
        cat: 'games',
        fn: async ($, data, { gamename, gamelink } = {}) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data[gamename || 'asahotak'] ||= await fetchJSON(gamelink || 'https://raw.githubusercontent.com/Veanyxz/json/main/game/asahotak.json');
            const soal = _.sample(cache.data.asahotak);
            waiter.tambahkan($.pengirim, ['asahotak'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
                gamename: gamename,
                _sessionName: gamename,
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (waiter, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    waiter.hapus();
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', waiter.val.jawaban) };
                }
                if (new RegExp(waiter.val.jawaban).test($.teks.trim().toLowerCase())) {
                    waiter.hapus();
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', waiter.val.jawaban) };
                } else {
                    if (--waiter.val.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', waiter.val.retries) };
                    } else {
                        waiter.hapus();
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', waiter.val.jawaban) };
                    }
                }
            } else {
                return waiter.notice('/cancel', waiter.val.gamename || 'asahotak');
            }
        },
    },
    caklontong: {
        stx: '/caklontong (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data.caklontong ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/caklontong.json');
            const soal = _.sample(cache.data.caklontong);
            waiter.tambahkan($.pengirim, ['caklontong'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                deskripsi: soal.deskripsi,
                retries: 5,
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (waiter, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    waiter.hapus();
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`) };
                }
                if (new RegExp(waiter.val.jawaban).test($.teks.trim().toLowerCase())) {
                    waiter.hapus();
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`) };
                } else {
                    if (--waiter.val.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', waiter.val.retries) };
                    } else {
                        waiter.hapus();
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`) };
                    }
                }
            } else {
                return waiter.notice('/cancel', 'caklontong');
            }
        },
    },
    siapakahaku: {
        stx: '/siapakahaku (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            return await Perintah.asahotak.fn($, {}, { gamename: 'siapakahaku', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/siapakahaku.json' });
        },
    },
    susunkata: {
        stx: '/susunkata (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data.susunkata ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/susunkata.sjon');
            const soal = _.sample(cache.data.susunkata);
            waiter.tambahkan($.pengirim, ['asahotak'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
                gamename: 'susunkata',
                _sessionName: 'susunkata',
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', `${soal.soal} (${soal.tipe})`) };
        },
    },
    tebaklirik: {
        stx: '/tebaklirik (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            return await Perintah.asahotak.fn($, {}, { gamename: 'tebaklirik', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaklirik.json' });
        },
    },
    tebaktebakan: {
        stx: '/tebaktebakan (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            return await Perintah.asahotak.fn(
                $,
                {},
                { gamename: 'tebaktebakan', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaktebakan.json' }
            );
        },
    },
    getid: {
        stx: '/getid',
        cat: 'bot',
        fn: () => {},
    },
    getuid: {
        stx: '/getuid',
        cat: 'bot',
        fn: () => {},
    },
    help: {
        stx: '/help',
        cat: 'bot',
        aliasfor: 'menu',
        fn: ($) => Perintah.menu.fn($),
    },
    kbbi: {
        stx: '/KBBI [q] (Indonesia)',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.arg) return { teks: $.TEKS('command/kbbi') };
            try {
                const [ANTONIM, GABUNGANKATA, KATATURUNAN, ARTI, PERIBAHASA, TERKAIT, LIHATJUGA, SINONIM, TRANSLASI] = $.TEKS('command/kbbi/$words')
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
                    teks: $.TEKS('command/kbbi/error') + '\n\n' + String(eror),
                };
            }
        },
    },
    lowercase: {
        stx: '/lowercase [text]',
        cat: 'tools',
        fn: ($) => {
            if ($.arg) {
                return {
                    teks: $.arg.toLowerCase(),
                };
            } else {
                return {
                    teks: $.TEKS('command/lowercase'),
                };
            }
        },
    },
    menu: {
        stx: '/menu',
        cat: 'bot',
        fn: ($) => {
            return {
                teks: $.TEKS('command/menu').replace('%', listPerintah($.TEKS('command/menu/$categories'), Perintah).teks),
            };
        },
    },
    pricing: {
        stx: '/pricing',
        cat: 'bot',
        fn: () => {},
    },
    register: {
        stx: '/register [name]',
        cat: 'bot',
        fn: async ($, data) => {
            if (data.u) return { teks: $.TEKS('command/register/alreadyregistered') };
            if (!$.argumen || $.argumen.length > 25) return { teks: $.TEKS('command/register') };
            const { _e } = await DB.buat({
                _id: $.uid,
                join: Date.now(),
                name: $.argumen,
            });
            if (_e) throw _e;
            return { teks: $.TEKS('command/register/done').replace('%name', $.argumen).replace('%id', $.uid).replace('%date', new Date().toString()) };
        },
    },
    reversetext: {
        stx: '/reversetext [text]',
        cat: 'tools',
        fn: ($) => {
            if ($.arg) {
                return {
                    teks: _.split($.arg, '').reverse().join(''),
                };
            } else {
                return {
                    teks: $.TEKS('command/reversetext'),
                };
            }
        },
    },
    say: {
        stx: '/say [text]',
        cat: 'fun',
        fn: ($) => {
            return {
                teks: $.arg,
            };
        },
    }, //
    set: {
        stx: '/set >>',
        cat: 'bot',
        fn: async ($, data) => {
            if (!data.u) return { teks: $.TEKS('permission/registeredonly') };

            if (!$.argumen) return listPerintah($.TEKS('command/set/$categories'), Perintah.set._);
            const setting = $.args[0].toLowerCase();
            if (Perintah.set._.hasOwnProperty(setting)) {
                $._argumen = $.argumen.replace(new RegExp(`^${_.escapeRegExp($.args[0])}\\s*`), '');
                return await Perintah.set._[setting].fn($, data);
            } else return listPerintah($.TEKS('command/set/$categories'), Perintah.set._);
        },
        _: {
            lang: {
                stx: '/set lang [lc]',
                cat: 'userinterface',
                fn: async ($) => {
                    if ($.pengirim.endsWith('#C')) {
                        if (!(await IPC.kirimKueri($.platform, { isAdmin: { c: $.pengirim, u: $.uid } })).admin) return { teks: $.TEKS('permission/adminonly') };
                    }
                    const langs = Object.keys(TEKS);
                    if (!$.args[1]) return { teks: $.TEKS('command/set/lang') };
                    $.args[1] = $.args[1].toLowerCase();
                    if (!langs.includes($.args[1])) return { teks: $.TEKS('command/set/lang') };
                    const { _e } = await DB.perbarui({ _id: $.pengirim.endsWith('#C') ? $.pengirim : $.uid }, { $set: { lang: $.args[1] } });
                    if (_e) throw _e;
                    return { teks: TEKS[$.args[1]]['command/set/lang/done'].replace('%lang', $.args[1]) };
                },
            },
            name: {
                stx: '/set name [name]',
                cat: 'userdata',
                fn: async ($, data) => {
                    if (!$._argumen || $._argumen.length > 25) return { teks: $.TEKS('command/set/name') };
                    const { _e } = await DB.perbarui({ _id: $.uid }, { $set: { name: $._argumen } });
                    if (_e) throw _e;
                    return { teks: $.TEKS('command/set/name/done').replace('%old', data.u.name).replace('%new', $._argumen) };
                },
            },
        },
    },
    setpremiumuser: {
        stx: '/setpremiumuser [id] [lvl] [dur]',
        cat: 'dev',
        fn: async ($) => {
            if (!cekDev($.uid)) return { teks: $.TEKS('permission/devonly') };
            let [id, level, durasi] = $.argumen.split(/\s+/),
                perpanjang = false;
            if (!id) return { teks: $.TEKS('command/setpremiumuser') };
            if (isNaN(+level) || +level < 0 || +level > 2) return { teks: $.TEKS('command/setpremiumuser') };
            if (durasi?.startsWith?.('+')) {
                perpanjang = true;
                durasi = durasi.slice(1);
            }
            if (durasi?.endsWith?.('d')) {
                durasi = `${+durasi.slice(0, -1) * 86_400_000}`;
            }
            if (level !== '0' && isNaN(+durasi)) return { teks: $.TEKS('command/setpremiumuser') };
            const udata = (await DB.cari({ _id: id })).hasil;
            let e;
            if (udata) e = await DB.perbarui({ _id: id }, { $set: { premlvl: +level, expiration: perpanjang ? udata.expiration + +durasi : Date.now() + +durasi } });
            else if (+level) e = await DB.buat({ _id: id, premlvl: +level, expiration: Date.now() + +durasi });
            if (e._e) throw e._e;
            const namaLvl = ['Free User', 'Premium Lite', 'Premium Xtreme'][+level];
            if (+level)
                return {
                    teks: $.TEKS('command/setpremiumuser/done')
                        .replace('%id', id)
                        .replace('%lvl', namaLvl)
                        .replace('%date', new Date(perpanjang ? udata.expiration + +durasi : Date.now() + +durasi)),
                };
            return {
                teks: $.TEKS('command/setpremiumuser/doneremove')
                    .replace('%id', id)
                    .replace('%lvl', namaLvl)
                    .replace('%date', new Date(perpanjang ? udata.expiration + +durasi : Date.now() + +durasi)),
            };
        },
    },
    sticker: {
        stx: '/sticker',
        cat: 'converter',
        fn: async ($) => {
            if (!$.pengirim.startsWith('WA#')) return { teks: $.TEKS('command/sticker/onlywhatsapp') };
            if ($.gambar || $.q?.gambar) {
                const gambar = $.gambar || $.q?.gambar;
                if (gambar.ukuran > 1000000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                const { file, _e } = await unduh($.pengirim, gambar);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, 'jpg');
                _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
                return { stiker: { file: _webp } };
            } else if ($.video || $.q?.video) {
                const video = $.video || $.q?.video;
                if (video.ukuran > 1000000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                const { file, _e } = await unduh($.pengirim, video);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, 'mp4');
                _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
                return { stiker: { file: _webp } };
            } else if ($.dokumen || $.q?.dokumen) {
                const dokumen = $.dokumen || $.q?.dokumen;
                if (dokumen.ukuran > 1000000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                if (!['jpg', 'png', 'gif', 'mp4', 'webp', 'mpeg', 'avi', 'ogv', 'webm', '3gp'].includes(dokumen.eks))
                    return { teks: $.TEKS('command/sticker/documentnotsupported') };
                const { file, _e } = await unduh($.pengirim, dokumen);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, dokumen.eks);
                _webp = await webp.setExif(_webp, 'Miki Bot', 'multiplatform chatbot by RiozeC');
                return { stiker: { file: _webp } };
            } else {
                return { teks: $.TEKS('command/sticker/nomedia') };
            }
        },
    },
    unsticker: {
        stx: '/unsticker',
        cat: 'converter',
        fn: async ($) => {
            if ($.stiker || $.q?.stiker) {
                const stiker = $.stiker || $.q?.stiker;
                if (stiker.animasi) {
                    if ($.platform === 'TG') return { teks: $.TEKS('command/unsticker/animatedstickertelegramnotsupported') };
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
            } else {
                return { teks: $.TEKS('command/unsticker/nomedia') };
            }
        },
    },
    uppercase: {
        stx: '/uppercase [text]',
        cat: 'tools',
        fn: ($) => {
            if ($.arg) {
                return {
                    teks: $.arg.toUpperCase(),
                };
            } else {
                return {
                    teks: $.TEKS('command/uppercase'),
                };
            }
        },
    },
    google: {
        stx: '/google [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/google') };
            const res = await (await lolHumanAPI('gsearch', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return { teks: res.result.map((v) => `• ${v.title}\n${v.link}\n${v.desc}`).join('\n\n') };
        },
    },
    playstore: {
        stx: '/playstore [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/playstore') };
            const res = await (await lolHumanAPI('playstore', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result.map((v) => `• ${v.title} (${v.developer})\n${v.url}\n*${v.scoreText} - ${v.free ? 'Free' : v.priceText}\n${v.summary}`).join('\n\n'),
            };
        },
    },
    youtube: {
        stx: '/youtube [q]',
        cat: 'searchengine',
        fn: async ($, data) => {
            if (!$.argumen) return { teks: $.TEKS('command/youtube') };
            const res = await (await lolHumanAPI('ytsearch', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result[0]?.thumbnail ? { url: res.result[0].thumbnail } : undefined,
                teks: res.result.map((v) => `• ${v.title}\n${v.published} | ${v.views}\nhttps://youtube.com/watch?v=${v.videoId}`).join('\n\n'),
            };
        },
    },
    ytaudio: {
        stx: '/ytaudio [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/ytaudio') };
            if (!/^(https?:\/\/)?(www\.)?youtu(\.be|be\.com)/.test($.argumen)) return { teks: $.TEKS('command/ytaudio') };
            $.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen;
            const res = await (await lolHumanAPI('ytaudio', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            try {
                const ukuranAudioMaksimal = ukuranMaksimal.audio[$.platform],
                    ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                const { file, size } = await saveFetchByStream(await fetch(res.result.link.link), 'mp3', ukuranDokumenMaksimal);
                if (size < ukuranAudioMaksimal)
                    return {
                        audio: { file: file },
                        teks: res.result.title,
                        _limit: limit,
                    };
                return {
                    dokumen: { file: file, mimetype: 'audio/mp3', namaFile: res.result.title + '.mp3' },
                    _limit: limit,
                };
            } catch (e) {
                if (e === 'toobig')
                    return {
                        teks: $.TEKS('command/ytaudio/toobig')
                            .replace('%alink', await getShortLink(res.result.link.link))
                            .replace('%asize', res.result.link.size)
                            .replace('%ares', res.result.link.bitrate + 'kb/s'),
                    };
                throw e;
            }
        },
    },
    ytvideo: {
        stx: '/ytvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/ytvideo') };
            if (!/^(https?:\/\/)?(www\.)?youtu(\.be|be\.com)/.test($.argumen)) return { teks: $.TEKS('command/ytvideo') };
            $.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen;
            const res = await (await lolHumanAPI('ytvideo', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            try {
                const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                    ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                const { file, size } = await saveFetchByStream(await fetch(res.result.link.link), 'mp4', ukuranDokumenMaksimal);
                if (size < ukuranVideoMaksimal)
                    return {
                        video: { file: file },
                        teks: res.result.title,
                        _limit: limit,
                    };
                return {
                    dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                    _limit: limit,
                };
            } catch (e) {
                if (e === 'toobig')
                    return {
                        teks: $.TEKS('command/ytvideo/toobig')
                            .replace('%vlink', await getShortLink(res.result.link.link))
                            .replace('%vsize', res.result.link.size)
                            .replace('%vres', res.result.link.resolution),
                    };
                throw e;
            }
        },
    },
    jadwaltv: {
        stx: '/jadwaltv [channel] (Indonesia)',
        cat: 'information',
        fn: async ($) => {
            if (!$.args[0]) return { teks: $.TEKS('command/jadwaltv') };
            $.args[0] = $.args[0].toLowerCase();
            if ($.args[0] === 'now') return { teks: $.TEKS('command/jadwaltv/notfound') };
            const res = await (await lolHumanAPI('jadwaltv/' + encodeURI($.args[0].toLowerCase()))).json();
            if (res.status == 404) return { teks: $.TEKS('command/jadwaltv/notfound') };
            if (res.status != 200) throw res.message;
            return {
                teks: Object.entries(res.result)
                    .map((v) => `${v[0]} - ${v[1]}`)
                    .join('\n'),
            };
        },
    },
    acaratv: {
        stx: '/acaratv (Indonesia)',
        cat: 'information',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('jadwaltv/now')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: Object.entries(res.result)
                    .map((v) => `[${v[0].toUpperCase()}] ${v[1].trim().split('\n').reverse()[0]}`)
                    .join('\n'),
            };
        },
    },
    fbvideo: {
        stx: '/fbvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.|m\.|web\.|mbasic\.)?(facebook|fb)\.(com|watch)/.test($.argumen)) return { teks: $.TEKS('command/fbvideo') };
            $.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen;
            const res = await (await lolHumanAPI('facebook', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            if (!res.result) return { teks: $.TEKS('command/fbvideo/cantdownload') };
            try {
                const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                    ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                const { file, size } = await saveFetchByStream(await fetch(res.result), 'mp4', ukuranDokumenMaksimal);
                if (size < ukuranVideoMaksimal)
                    return {
                        video: { file: file },
                        _limit: limit,
                    };
                return {
                    dokumen: { file: file, mimetype: 'video/mp4', namaFile: file },
                    _limit: limit,
                };
            } catch (e) {
                if (e === 'toobig')
                    return {
                        teks: $.TEKS('command/fbvideo/toobig').replace('%vlink', await getShortLink(res.result)),
                    };
                throw e;
            }
        },
    },
    cerpen: {
        stx: '/cerpen (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('cerpen')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: `${res.result.title}\n\nKarangan: ${res.result.creator}\n\n\t${res.result.cerpen}`,
            };
        },
    },
    pantun: {
        stx: '/pantun (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/pantun')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    puisi: {
        stx: '/puisi (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/puisi')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    faktaunik: {
        stx: '/faktaunik (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/faktaunik')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    ceritahoror: {
        stx: '/ceritahoror (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('ceritahoror')).json();
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result.thumbnail ? { url: res.result.thumbnail } : undefined,
                teks: `${res.result.title}\n\n${res.result.desc}\n\n\t${res.result.story}`,
            };
        },
    },
    googleimage: {
        stx: '/googleimage [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/googleimage') };
            const res = await (await lolHumanAPI('gimage2', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) {
                const f = await lolHumanAPI('gimage', 'query=' + encodeURI($.argumen));
                if (f.status != 200) throw f.statusText;
                try {
                    const { file } = await saveFetchByStream(f, 'jpg');
                    return {
                        gambar: { file: file },
                    };
                } catch (e) {
                    throw e;
                }
            } else {
                const result = _.sample(res.result);
                return {
                    gambar: { url: result },
                    teks: result,
                };
            }
        },
    },
    pinterest: {
        stx: '/pinterest [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/pinterest') };
            let res = await (await lolHumanAPI('pinterest2', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) res = await (await lolHumanAPI('pinterest', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const result = Array.isArray(res.result) ? _.sample(res.result) : res.result;
            return {
                gambar: { url: result },
                teks: result,
            };
        },
    },
    katabijak: {
        stx: '/katabijak [q] (Indonesia)',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/katabijak') };
            let res = await (await lolHumanAPI('searchbijak', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const result = _.sample(res.result);
            return {
                teks: `"${result.quote}"\n\n- ${result.author}`,
            };
        },
    },
    couplepic: {
        stx: '/couplepic',
        cat: 'randomimage',
        fn: async ($, data) => {
            let res = await (await lolHumanAPI('random/ppcouple')).json();
            if (res.status != 200) throw res.message;
            const { _e } = await _kirimPesan($.pengirim, {
                gambar: { url: res.result.male },
                teks: res.result.male,
                re: true,
                mid: $.mid,
            });
            if (_e) throw _e;
            return {
                gambar: { url: res.result.female },
                teks: res.result.female,
            };
        },
    },
    bts: {
        stx: '/BTS',
        cat: 'randomimage',
        fn: async ($, data, { endpoint } = {}) => {
            const { file } = await saveFetchByStream(await lolHumanAPI(endpoint || 'random/bts'), 'jpg');
            return {
                gambar: { file: file },
            };
        },
    },
    exo: {
        stx: '/EXO',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/exo' });
        },
    },
    prettygirls: {
        stx: '/prettygirls',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/cecan' });
        },
    },
    handsomeguys: {
        stx: '/handsomeguys',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/cogan' });
        },
    },
    aesthetic: {
        stx: '/aesthetic',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/estetic' });
        },
    },
    erufu: {
        stx: '/erufu',
        cat: 'randomimage',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            const { file } = await saveFetchByStream(await lolHumanAPI('random/elf'), 'jpg');
            return {
                gambar: { file: file },
                _limit: limit,
            };
        },
    },
    neko: {
        stx: '/neko',
        cat: 'randomimage',
        lim: true,
        fn: async ($, data, { endpoints } = {}) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            endpoints = _.shuffle(endpoints || ['random/neko', 'random2/neko']);
            let f, e;
            for (const endpoint of endpoints) {
                e = endpoint;
                f = await lolHumanAPI(endpoint);
                if (f.status == 200) break;
            }
            if (f.status != 200) throw `${f.status} ${e}`;
            const { file } = await saveFetchByStream(f, 'jpg');
            return {
                gambar: { file: file },
                _limit: limit,
            };
        },
    },
    waifu: {
        stx: '/waifu',
        cat: 'randomimage',
        fn: async ($, data, { endpoints } = {}) => {
            endpoints = endpoints || ['random/waifu', 'random2/waifu'];
            let f, e;
            for (const endpoint of endpoints) {
                e = endpoint;
                f = await lolHumanAPI(endpoint);
                if (f.status == 200) break;
            }
            if (f.status != 200) throw `${f.status} ${e}`;
            const { file } = await saveFetchByStream(f, 'jpg');
            return {
                gambar: { file: file },
            };
        },
    },
    husbu: {
        stx: '/husbu',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/husbu' });
        },
    },
    blackpink: {
        stx: '/blackpink',
        cat: 'randomimage',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'random/blackpink' });
        },
    },
    feed: {
        stx: '/feed',
        cat: 'reactions',
        fn: async ($, { endpoint } = {}) => {
            const f = await lolHumanAPI(endpoint || 'random2/feed');
            if (f.status != 200) throw `${res.status} ${endpoint}`;
            if (f.headers.get('content-type') === 'image/gif') {
                const { file } = await saveFetchByStream(f, 'gif');
                if ($.platform === 'WA') {
                    file = await gif.keMp4(file);
                    return {
                        video: { file: file, gif: true },
                    };
                } else
                    return {
                        video: { file: file, gif: true },
                    };
            } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                const { file } = await saveFetchByStream(f, 'jpg');
                return {
                    gambar: { file: file },
                };
            } else {
                throw `not an image, received: ${res.headers.get('content-type')}`;
            }
        },
    },
    poke: {
        stx: '/poke',
        cat: 'reactions',
        fn: async ($, { endpoints } = {}) => {
            endpoints = _.shuffle(endpoints || ['random/poke', 'random2/poke']);
            let f, e;
            for (const endpoint of endpoints) {
                e = endpoint;
                f = await lolHumanAPI(endpoint);
                if (f.status == 200) break;
            }
            if (f.status != 200) throw `${f.status} ${e}`;
            if (f.headers.get('content-type') === 'image/gif') {
                const { file } = await saveFetchByStream(f, 'gif');
                if ($.platform === 'WA') {
                    file = await gif.keMp4(file);
                    return {
                        video: { file: file, gif: true },
                    };
                } else
                    return {
                        video: { file: file, gif: true },
                    };
            } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                const { file } = await saveFetchByStream(f, 'jpg');
                return {
                    gambar: { file: file },
                };
            } else {
                throw `not an image, received: ${res.headers.get('content-type')}`;
            }
        },
    },
    kiss: {
        stx: '/kiss',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.poke.fn($, { endpoints: ['random/kiss', 'random2/kiss'] });
        },
    },
    smug: {
        stx: '/smug',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.poke.fn($, { endpoints: ['random/smug', 'random2/smug'] });
        },
    },
    baka: {
        stx: '/baka',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random2/baka' });
        },
    },
    tickle: {
        stx: '/tickle',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random2/tickle' });
        },
    },
    cuddle: {
        stx: '/cuddle',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.poke.fn($, { endpoints: ['random/cuddle', 'random2/cuddle'] });
        },
    },
    bully: {
        stx: '/bully',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/bully' });
        },
    },
    cry: {
        stx: '/cry',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/cry' });
        },
    },
    hug: {
        stx: '/hug',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/hug' });
        },
    },
    lick: {
        stx: '/lick',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/lick' });
        },
    },
    bonk: {
        stx: '/bonk',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/bonk' });
        },
    },
    yeet: {
        stx: '/yeet',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/yeet' });
        },
    },
    blush: {
        stx: '/blush',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/blush' });
        },
    },
    smile: {
        stx: '/smile',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/smile' });
        },
    },
    wave: {
        stx: '/wave',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/wave' });
        },
    },
    highfive: {
        stx: '/highfive',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/highfive' });
        },
    },
    handhold: {
        stx: '/handhold',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/handhold' });
        },
    },
    nom: {
        stx: '/nom',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/nom' });
        },
    },
    bite: {
        stx: '/bite',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/bite' });
        },
    },
    glomp: {
        stx: '/glomp',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/glomp' });
        },
    },
    kill: {
        stx: '/kill',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/kill' });
        },
    },
    slap: {
        stx: '/slap',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/slap' });
        },
    },
    happy: {
        stx: '/happy',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/happy' });
        },
    },
    wink: {
        stx: '/wink',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/wink' });
        },
    },
    dance: {
        stx: '/dance',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/dance' });
        },
    },
    cringe: {
        stx: '/cringe',
        cat: 'reactions',
        fn: async ($) => {
            return await Perintah.feed.fn($, { endpoint: 'random/cringe' });
        },
    },
    anime: {
        stx: '/anime [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/anime') };
            const res = await (await lolHumanAPI('anime', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const _ = res.result;
            return {
                gambar: res.result?.coverImage?.large ? { url: res.result?.coverImage?.large } : undefined,
                teks: `EN: ${_.title.english || '-'}\nJP: ${_.title.native} (${_.title.romaji})\n${_.idMal ? '\nmyanimelist.net/anime/' + _.idMal : ''}\nFormat: ${
                    _.format
                }\nEpisodes: ${_.episodes}\nDuration: ${_.duration} min.\nStatus: ${_.status}\nSeason: ${_.season} (${_.seasonYear})\nGenres: ${_.genres.join(
                    ', '
                )}.\nStart: ${Object.values(_.startDate).join('-')}\nEnd: ${Object.values(_.endDate).join('-')}\nScore: ${_.averageScore}\nSynonyms: ${_.synonyms.join(
                    ' / '
                )}.${_.nextAiringEpisode ? '\nNext airing episode: ' + _.nextAiringEpisode : ''}\n\nDescription: ${_.description}\n\nCharacters: ${_.characters.nodes
                    .map((v) => `${v.name.full} (${v.name.native})`)
                    .join(', ')}`,
            };
        },
    },
    manga: {
        stx: '/manga [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/manga') };
            const res = await (await lolHumanAPI('manga', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const _ = res.result;
            return {
                gambar: res.result?.coverImage?.large ? { url: res.result?.coverImage?.large } : undefined,
                teks: `EN: ${_.title.english || '-'}\nJP: ${_.title.native} (${_.title.romaji})\n${_.idMal ? '\nmyanimelist.net/manga/' + _.idMal : ''}\nFormat: ${
                    _.format
                }\nChapters: ${_.chapters}\nVolumes: ${_.volumes}\nStatus: ${_.status}\nSource: ${_.source}\nGenres: ${_.genres.join(', ')}.\nStart: ${Object.values(
                    _.startDate
                ).join('-')}\nEnd: ${Object.values(_.endDate).join('-')}\nScore: ${_.averageScore}\nSynonyms: ${_.synonyms.join(' / ')}.\n\nDescription: ${
                    _.description
                }\n\nCharacters: ${_.characters.nodes.map((v) => `${v.name.full} (${v.name.native})`).join(', ')}`,
            };
        },
    },
    animangachar: {
        stx: '/animangachar [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/animangachar') };
            const res = await (await lolHumanAPI('character', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const _ = res.result;
            return {
                gambar: res.result?.image?.large ? { url: res.result?.image?.large } : undefined,
                teks: `${_.name.full} (${_.name.native})\n\nDescription: ${_.description}\n\nMedia:\n${_.media.nodes
                    .map((v, i) => `${i + 1}. [${v.type}] ${v.title.romaji} (${v.title.native})`)
                    .join('\n')}`,
            };
        },
    },
    whatanime: {
        stx: '/whatanime',
        cat: 'searchengine',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if ($.gambar || $.q?.gambar) {
                const { file } = await unduh($.pengirim, $.gambar || $.q.gambar);
                const { size } = await fsp.stat(file);
                const form = new FormData();
                const stream = fs.createReadStream(file);
                form.append('img', stream, { knownLength: size });
                const res = await (await postToLolHumanAPI('wait', form)).json();
                if (res.status != 200) throw res.message;
                return {
                    video: res.result.video ? { url: res.result.video } : undefined,
                    teks: $.TEKS('command/whatanime/result')
                        .replace('%sim', res.result.similarity)
                        .replace('%eng', res.result.title_english)
                        .replace('%jp', res.result.title_native)
                        .replace('%ro', res.result.title_romaji)
                        .replace('%at', res.result.at)
                        .replace('%eps', res.result.episode),
                    _limit: limit,
                };
            } else {
                return {
                    teks: $.TEKS('command/whatanime/nomedia'),
                };
            }
        },
    },
    whatmanga: {
        stx: '/whatmanga',
        cat: 'searchengine',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if ($.gambar || $.q?.gambar) {
                const { file } = await unduh($.pengirim, $.gambar || $.q.gambar);
                const { size } = await fsp.stat(file);
                const form = new FormData();
                const stream = fs.createReadStream(file);
                form.append('img', stream, { knownLength: size });
                const res = await (await postToLolHumanAPI('wmit', form)).json();
                if (res.status != 200) throw res.message;
                return {
                    teks: $.TEKS('command/whatmanga/result')
                        .replace('%sim', res.result[0].similarity)
                        .replace('%title', res.result[0].title)
                        .replace('%part', res.result[0].part)
                        .replace('%urls', res.result[0].urls.join('\n')),
                    _limit: limit,
                };
            } else {
                return {
                    teks: $.TEKS('command/whatmanga/nomedia'),
                };
            }
        },
    },
    otakudesu: {
        stx: '/otakudesu [q/url] (Indonesia)',
        cat: 'searchengine',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/otakudesu') };
            let res;
            if (/^(https?:\/\/)?(www\.)?otakudesu\.moe\//.test($.argumen.trim())) {
                res = await (await lolHumanAPI('otakudesu', 'url=' + encodeURI($.argumen.trim()))).json();
            } else {
                res = await (await lolHumanAPI('otakudesusearch', 'query=' + encodeURI($.argumen.trim()))).json();
            }
            if (res.status != 200) throw res.message;
            const file = `./tmp/${utils.namaFileAcak()}.txt`;
            await fsp.writeFile(
                file,
                res.result.link_dl
                    .map(
                        (v) =>
                            `• ${v.title}\n${v.link_dl
                                .map(
                                    (v) =>
                                        `${v.reso} -- ${v.size}\n${Object.entries(v.link_dl)
                                            .map((v) => `[${v[0]}] ${v[1]}`)
                                            .join('\n')}`
                                )
                                .join('\n')}`
                    )
                    .join('\n\n')
            );
            return {
                dokumen: { file: file, mimetype: 'text/plain', namaFile: res.result.title },
                teks: $.TEKS('command/otakudesu/result')
                    .replace('%titlejp', res.result.japanese)
                    .replace('%title', res.result.title)
                    .replace('%type', res.result.type)
                    .replace('%eps', res.result.episodes)
                    .replace('%dur', res.result.duration)
                    .replace('%genres', res.result.duration)
                    .replace('%aired', res.result.aired)
                    .replace('%prod', res.result.producers)
                    .replace('%stu', res.result.studios)
                    .replace('%rate', res.result.rating)
                    .replace('%creds', res.result.credit),
            };
        },
    },
    kusonime: {
        stx: '/kusonime [q/url] (Indonesia)',
        cat: 'searchengine',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/kusonime') };
            let res;
            if (/^(https?:\/\/)?(www\.)?kusonime\.com\//.test($.argumen.trim())) {
                res = await (await lolHumanAPI('kusonime', 'url=' + encodeURI($.argumen.trim()))).json();
            } else {
                res = await (await lolHumanAPI('kusonimesearch', 'query=' + encodeURI($.argumen.trim()))).json();
            }
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result.thumbnail ? { url: res.result.thumbnail } : undefined,
                teks: $.TEKS('command/kusonime/result')
                    .replace('%title', res.result.title)
                    .replace('%jp', res.result.japanese)
                    .replace('%genres', res.result.genre)
                    .replace('%season', res.result.seasons)
                    .replace('%prod', res.result.producers)
                    .replace('%type', res.result.type)
                    .replace('%status', res.result.status)
                    .replace('%eps', res.result.total_episode)
                    .replace('%score', res.result.score)
                    .replace('%dur', res.result.duration)
                    .replace('%release', res.result.released_on)
                    .replace('%desc', res.result.desc)
                    .replace(
                        '%dl',
                        Object.entries(res.result.link_dl)
                            .map(
                                (v) =>
                                    `• ${v[0]}\n${Object.entries(v[1])
                                        .map((v) => `[${v[0]}] ${v[1]}`)
                                        .join('\n')}`
                            )
                            .join('\n\n')
                    ),
            };
        },
    },
    lk21: {
        stx: '/lk21 [q] (Indonesia)',
        cat: 'searchengine',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/lk21') };
            const res = await (await lolHumanAPI('lk21', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result.thumbnail ? { url: res.result.thumbnail } : undefined,
                teks: $.TEKS('command/lk21/result')
                    .replace('%title', res.result.title)
                    .replace('%link', res.result.link)
                    .replace('%genres', res.result.genre)
                    .replace('%dur', res.result.duration)
                    .replace('%release', res.result.date_release)
                    .replace('%rate', res.result.rating)
                    .replace('%views', res.result.views)
                    .replace('%lang', res.result.language)
                    .replace('%loc', res.result.location)
                    .replace('%dlink', res.result.link_dl || '-')
                    .replace('%desc', res.result.desc)
                    .replace('%actor', res.result.actors.join(', ')),
                _limit: res.result.link_dl ? limit : undefined,
            };
        },
    },
    jooxdl: {
        stx: '/jooxdl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/jooxdl') };
            if (!/^(https?:\/\/)?(www\.)?joox\.com\//.test($.argumen)) return { teks: $.TEKS('command/jooxdl') };
            const id = new URL(($.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen)).pathname.split('/').reverse()[0];
            const res = await (await lolHumanAPI('joox/' + id)).json();
            if (res.status != 200) throw res.message;
            res.result.audio = res.result.audio?.reverse?.()?.filter?.((v) => v.link);
            if (!res.result.audio?.length) throw 'noaudio';
            const ukuranAudioMaksimal = ukuranMaksimal.audio[$.platform],
                ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
            const { file, size } = await saveFetchByStream(await fetch(res.result.audio[0].link), 'mp3', ukuranDokumenMaksimal);
            if (size < ukuranAudioMaksimal)
                return {
                    audio: { file: file },
                    _limit: limit,
                };
            return {
                dokumen: { file: file, mimetype: 'audio/mp3', namaFile: res.result.title + '.mp3' },
                _limit: limit,
            };
        },
    },
    spotify: {
        stx: '/spotify [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/spotify') };
            const res = await (await lolHumanAPI('spotifysearch', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result
                    .sort((a, b) => a.popularity - b.popularity)
                    .map((v) => `• ${v.artists} - ${v.title}\n[${Math.floor(v.duration / 60) + ':' + (v.duration % 60)}] ${v.link}`)
                    .join('\n\n'),
            };
        },
    },
    spotifydl: {
        stx: '/spotifydl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/spotifydl') };
            if (!/^(https?:\/\/)?(www\.|open\.)?spotify\.com\//.test($.argumen)) return { teks: $.TEKS('command/spotifydl') };
            const res = await (await lolHumanAPI('spotify', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const ukuranAudioMaksimal = ukuranMaksimal.audio[$.platform],
                ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
            const { file, size } = await saveFetchByStream(await fetch(res.result.link), 'mp3', ukuranDokumenMaksimal);
            if (size < ukuranAudioMaksimal)
                return {
                    audio: { file: file },
                    _limit: limit,
                };
            return {
                dokumen: { file: file, mimetype: 'audio/mp3', namaFile: res.result.title + '.mp3' },
                _limit: limit,
            };
        },
    },
    twittervideo: {
        stx: '/twittervideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            if (!$.argumen) return { teks: $.TEKS('command/twittervideo') };
            if (!/^(https?:\/\/)?(www\.)?twitter\.com\//.test($.argumen)) return { teks: $.TEKS('command/twittervideo') };
            const res = await (await lolHumanAPI('twitter2', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const reso = Object.fromEntries(res.result.link.map((v) => [new URL(v.url).pathname.split('/')[5].split('x')[1] + 'p', v.url]));
            waiter.tambahkan($.pengirim, ['twittervideo'], reso);
            return {
                gambar: res.result.thumbnail ? { url: res.result.thumbnail } : undefined,
                teks: $.TEKS('command/twittervideo/result')
                    .replace('%name', res.result.user?.name)
                    .replace('%usrname', res.result.user?.username)
                    .replace('%date', res.result.publish)
                    .replace('%capt', res.result.title)
                    .replace(
                        '%res',
                        Object.keys(reso)
                            .map((v) => `/${v} => ${v.toUpperCase()}`)
                            .join('\n')
                    ),
            };
        },
        hd: async (waiter, $, data) => {
            if ($.perintah === 'cancel') {
                waiter.hapus();
                return { teks: $.TEKS('user/dialogcancelled').replace('%d', 'twittervideo') };
            } else {
                let link;
                if ((link = waiter.val[$.perintah])) {
                    const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                        ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                    const { file, size } = await saveFetchByStream(await fetch(link), 'mp4', ukuranDokumenMaksimal);
                    waiter.hapus();
                    if (size < ukuranVideoMaksimal)
                        return {
                            video: { file: file },
                            _limit: cekLimit($, data),
                        };
                    return {
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                        _limit: cekLimit($, data),
                    };
                } else {
                    return waiter.notice('/cancel', 'twittervideo');
                }
            }
        },
    },
    instagramdl: {
        stx: '/instagramdl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            if (!$.argumen) return { teks: $.TEKS('command/instagramdl') };
            if (!/^(https?:\/\/)?(www\.)?instagram\.com\//.test($.argumen)) return { teks: $.TEKS('command/instagramdl') };
            const res = await (await lolHumanAPI('instagram', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            if (res.result.length === 1) {
                const f = await fetch(res.result[0]);
                if (f.headers.get('content-type') === 'video/mp4') {
                    const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                        ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                    const { file, size } = await saveFetchByStream(f, 'mp4', ukuranDokumenMaksimal);
                    console.log(size);
                    if (size < ukuranVideoMaksimal)
                        return {
                            video: { file: file },
                            _limit: limit,
                        };
                    return {
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                        _limit: limit,
                    };
                } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                    const { file } = await saveFetchByStream(f, 'jpg');
                    return {
                        gambar: { file: file },
                        _limit: limit,
                    };
                } else {
                    throw 'nomedia';
                }
            } else if (res.result.length > 1) {
                waiter.tambahkan($.pengirim, ['instagramdl'], { medias: res.result });
                return {
                    teks: $.TEKS('command/instagramdl/result').replace('%count', res.result.length),
                };
            } else {
                throw 'nolink';
            }
        },
        hd: async (waiter, $, data) => {
            if ($.perintah === 'cancel') {
                waiter.hapus();
                return { teks: $.TEKS('user/dialogcancelled').replace('%d', 'instagramdl') };
            } else if ($.perintah === 'all') {
                Promise.allSettled(
                    waiter.val.medias.map(
                        (v, i) =>
                            new Promise(async (resolve, reject) => {
                                try {
                                    const f = await fetch(v);
                                    if (f.headers.get('content-type') === 'video/mp4') {
                                        const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                                            ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                                        const { file, size } = await saveFetchByStream(f, 'mp4', ukuranDokumenMaksimal);
                                        if (size < ukuranVideoMaksimal)
                                            return resolve(
                                                kirimPesan($.pengirim, {
                                                    video: { file: file },
                                                    re: true,
                                                    mid: $.mid,
                                                })
                                            );
                                        return resolve(
                                            kirimPesan($.pengirim, {
                                                dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                                                re: true,
                                                mid: $.mid,
                                            })
                                        );
                                    } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                                        const { file } = await saveFetchByStream(f, 'jpg');
                                        return resolve(
                                            kirimPesan($.pengirim, {
                                                gambar: { file: file },
                                                re: true,
                                                mid: $.mid,
                                            })
                                        );
                                    } else {
                                        return reject(
                                            kirimPesan($.pengirim, {
                                                teks: $.TEKS('command/instagramdl/fail').replace('%c', i),
                                                re: true,
                                                mid: $.mid,
                                            })
                                        );
                                    }
                                } catch (e) {
                                    console.log(e);
                                    return reject(
                                        kirimPesan($.pengirim, {
                                            teks: $.TEKS('command/instagramdl/fail').replace('%c', i),
                                            re: true,
                                            mid: $.mid,
                                        })
                                    );
                                }
                            })
                    )
                ).then((v) => {
                    waiter.hapus();
                    v.filter((v) => v.status === 'fulfilled').length && cekLimit($, data).kurangi();
                });
            } else if (parseInt($.perintah) > 0 && parseInt($.perintah) <= waiter.val.medias.length) {
                const link = waiter.val.medias[parseInt($.perintah) - 1];
                const f = await fetch(link);
                if (f.headers.get('content-type') === 'video/mp4') {
                    const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                        ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                    const { file, size } = await saveFetchByStream(f, 'mp4', ukuranDokumenMaksimal);
                    waiter.hapus();
                    if (size < ukuranVideoMaksimal)
                        return {
                            video: { file: file },
                            _limit: cekLimit($, data),
                        };
                    return {
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                        _limit: cekLimit($, data),
                    };
                } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                    const { file } = await saveFetchByStream(f, 'jpg');
                    waiter.hapus();
                    return {
                        gambar: { file: file },
                        _limit: cekLimit($, data),
                    };
                } else {
                    waiter.hapus();
                    throw 'nomedia';
                }
            } else {
                return waiter.notice('/cancel', 'instagramdl');
            }
        },
    },
    tiktokvideo: {
        stx: '/tiktokvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/tiktokvideo') };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen)) return { teks: $.TEKS('command/tiktokvideo') };
            const f = await lolHumanAPI('tiktokwm', 'url=' + encodeURI($.argumen));
            if (f.status != 200) throw `${f.status} tiktokwm`;
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    tiktokvideonowm: {
        stx: '/tiktokvideoNoWM [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/tiktokvideonowm') };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen)) return { teks: $.TEKS('command/tiktokvideonowm') };
            let link, res, e;
            const endpoints = _.shuffle(['tiktok', 'tiktok2', 'tiktok3']);
            for (const endpoint of endpoints) {
                e = endpoint;
                res = await (await lolHumanAPI(endpoint, 'url=' + encodeURI($.argumen))).json();
                if (res.status == 200) break;
            }
            if (res.status != 200) throw `${res.status} ${res.message} ${e}`;
            if (e === 'tiktok') {
                link = res.result.link;
            } else {
                link = res.result;
            }
            const { file } = await saveFetchByStream(await fetch(link), 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    tiktokaudio: {
        stx: '/tiktokaudio [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/tiktokaudio') };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen)) return { teks: $.TEKS('command/tiktokaudio') };
            const f = await lolHumanAPI('tiktokmusic', 'url=' + encodeURI($.argumen));
            if (f.status != 200) throw `${f.status} tiktokmusic`;
            const { file } = await saveFetchByStream(f, 'mp3');
            return {
                audio: { file: file },
                _limit: limit,
            };
        },
    },
    mediafiredl: {
        stx: '/mediafiredl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?mediafire\.com\//.test($.argumen)) return { teks: $.TEKS('command/mediafiredl') };
            const res = await (await lolHumanAPI('mediafire', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.link;
            const f = await fetch(link);
            const maxSize = ukuranMaksimal.dokumen[$.platform];
            try {
                const { file } = await saveFetchByStream(f, mimetypes.extension(f.headers.get('content-type')), maxSize);
                return {
                    dokumen: { file: file, mimetype: f.headers.get('content-type'), namaFile: res.result.filename },
                    _limit: limit,
                };
            } catch (e) {
                if (e === 'toobig') return { teks: $.TEKS('command/mediafiredl/toobig').replace('%link', await getShortLink(link)) };
                throw e;
            }
        },
    },
    zippysharedl: {
        stx: '/zippysharedl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\d+\.)?zippyshare\.com\//.test($.argumen)) return { teks: $.TEKS('command/zippysharedl') };
            const res = await (await lolHumanAPI('zippyshare', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.download_url;
            const f = await fetch(link);
            const maxSize = ukuranMaksimal.dokumen[$.platform];
            try {
                const { file } = await saveFetchByStream(f, mimetypes.extension(f.headers.get('content-type')), maxSize);
                return {
                    dokumen: { file: file, mimetype: f.headers.get('content-type'), namaFile: res.result.filename },
                    _limit: limit,
                };
            } catch (e) {
                if (e === 'toobig') return { teks: $.TEKS('command/zippysharedl/toobig').replace('%link', await getShortLink(link)) };
                throw e;
            }
        },
    },
    pinterestimage: {
        stx: '/pinterestimage [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(\w+\.)?pinterest\.com\//.test($.argumen)) return { teks: $.TEKS('command/zippysharedl') };
            const res = await (await lolHumanAPI('pinterestdl', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = Object.entries(res.result).sort((a, b) => b[0] - a[0])[0][1];
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'jpg');
            return {
                gambar: { file: file },
                teks: link,
                _limit: limit,
            };
        },
    },
    pinterestvideo: {
        stx: '/pinterestvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(\w+\.)?pinterest\.com\//.test($.argumen)) return { teks: $.TEKS('command/pinterestvideo') };
            const res = await (await lolHumanAPI('pinterestvideo', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = Object.entries(res.result).sort((a, b) => b[0] - a[0])[0][1];
            const f = await fetch(link);
            const maxDocSize = ukuranMaksimal.dokumen[$.platform];
            const maxVidSize = ukuranMaksimal.video[$.platform];
            try {
                const { file, size } = await saveFetchByStream(f, 'mp4', maxDocSize);
                if (size < maxVidSize) {
                    return {
                        video: { file: file },
                        _limit: limit,
                    };
                } else {
                    return {
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: 'pinterest.mp4' },
                        _limit: limit,
                    };
                }
            } catch (e) {
                if (e === 'toobig') return { teks: $.TEKS('command/pinterestvideo/toobig').replace('%link', link) };
                throw e;
            }
        },
    },
    sharechatvideo: {
        stx: '/sharechatvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?sharechat\.com\/video\//.test($.argumen)) return { teks: $.TEKS('command/sharechatvideo') };
            const res = await (await lolHumanAPI('sharechat', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.link_dl;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    snackvideo: {
        stx: '/snackvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?sck\.io\/p/.test($.argumen)) return { teks: $.TEKS('command/snackvideo') };
            const res = await (await lolHumanAPI('snackvideo', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.link_dl;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    smulevideo: {
        stx: '/smulevideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?smule\.com\//.test($.argumen)) return { teks: $.TEKS('command/smulevideo') };
            const res = await (await lolHumanAPI('smule', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.video;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    smuleaudio: {
        stx: '/smuleaudio [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?smule\.com\//.test($.argumen)) return { teks: $.TEKS('command/smuleaudio') };
            const res = await (await lolHumanAPI('smule', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.audio;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'm4a');
            return {
                audio: { file: file },
                _limit: limit,
            };
        },
    },
    cocofun: {
        stx: '/cocofun [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?(icocofun\.com|i\.coco\.fun)\//.test($.argumen)) return { teks: $.TEKS('command/cocofun') };
            const res = await (await lolHumanAPI('smule', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.withwm;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    cocofunnowm: {
        stx: '/cocofunNoWM [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?(icocofun\.com|i\.coco\.fun)\//.test($.argumen)) return { teks: $.TEKS('command/cocofunnowm') };
            const res = await (await lolHumanAPI('cocofun', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            const link = res.result.nowm;
            const f = await fetch(link);
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    simsimi: {
        stx: '/simsimi (Indonesia)',
        cat: 'fun',
        lim: true,
        fn: ($, data) => {
            if (!cekPremium($, data)) return { teks: $.TEKS('permission/premiumonly') };
            cache.data.simsimi ||= {};
            if (cache.data.simsimi[$.pengirim]) {
                delete cache.data.simsimi[$.pengirim];
                return { teks: $.TEKS('command/simsimi/off') };
            } else {
                cache.data.simsimi[$.pengirim] = {
                    initiator: $.uid,
                    expiration: data.u.expiration,
                };
                return { teks: $.TEKS('command/simsimi/on') };
            }
        },
    },
    berita: {
        stx: '/berita (Indonesia)',
        cat: 'information',
        fn: async () => {
            const res = await (await lolHumanAPI('newsinfo')).json();
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result[0]?.urlToImage ? { url: res.result[0].urlToImage } : undefined,
                teks: res.result
                    .map((v) => `• ${v.title}\n${v.url}\n${new Date(v.publishedAt).toLocaleString()}${v.description ? ' - ' + v.description : ''}`)
                    .join('\n\n'),
            };
        },
    },
    '1cak': {
        stx: '/1cak (Indonesia)',
        cat: 'fun',
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'onecak' });
        },
    },
};

//////////////////// FUNGSI PEMBANTU

function saveFetchByStream(res, ext, maxSize) {
    return new Promise((resolve, reject) => {
        if (maxSize && +res.headers.get('content-length') > maxSize) {
            res.body.close();
            reject('toobig');
        }
        const filename = `./tmp/${utils.namaFileAcak()}.${ext}`;
        const stream = fs.createWriteStream(filename);
        res.body.pipe(stream);
        let size = 0;
        res.body.on('data', (chunk) => {
            size += chunk.length;
            if (maxSize && size > maxSize) {
                res.body.close();
                reject('toobig');
            }
        });
        res.body.on('end', () =>
            resolve({
                file: filename,
                size: size,
            })
        );
        res.body.on('error', reject);
        stream.on('error', reject);
    });
}

function listPerintah(listKategori, perintahObj) {
    const map = {};
    const cats = Object.fromEntries(listKategori.split('\n').map((v) => v.split('=')));
    for (const cmd in perintahObj) {
        const cat = cats[perintahObj[cmd].cat];
        if (!map[cat]) map[cat] = [];
        map[cat].push((perintahObj[cmd].lim ? '$ ' : '') + perintahObj[cmd].stx);
    }
    return {
        teks: Object.entries(map)
            .sort(() => _.random(-2, 2))
            .map((v) => '• ' + v[0] + '\n\n' + _.sortBy(v[1]).join('\n'))
            .join('\n\n'),
    };
}

const ukuranMaksimal = {
    dokumen: {
        WA: 100_000_000,
        TG: 2_000_000_000,
    },
    video: {
        WA: 100_000_000,
        TG: 50_000_000,
    },
    audio: {
        WA: 16_000_000,
        TG: 50_000_000,
    },
};

async function getShortLink(link) {
    let res = await (await lolHumanAPI('shortlink', 'url=' + encodeURI(link))).json();
    if (res.status == 200) return res.result;
    res = await (await lolHumanAPI('shortlink2', 'url=' + encodeURI(link))).json();
    if (res.status == 200) return res.result;
    res = await (await lolHumanAPI('shortlink3', 'url=' + encodeURI(link))).json();
    if (res.status == 200) return res.result;
    res = await (await lolHumanAPI('shortlink4', 'url=' + encodeURI(link))).json();
    if (res.status == 200) return res.result;
    return link;
}

function lolHumanAPI(API, ...params) {
    return fetch(`https://api.lolhuman.xyz/api/${API}?apikey=${argv.lolHumanAPIkey}&${params.join('&')}`);
}

function postToLolHumanAPI(API, body, opts = {}) {
    return fetch(`https://api.lolhuman.xyz/api/${API}?apikey=${argv.lolHumanAPIkey}`, {
        method: 'POST',
        credentials: 'include',
        body: body,
        ...opts,
    });
}

async function fetchJSON(link) {
    return await (await fetch(link)).json();
}

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
    IPC.terimaSinyal(pesan, (pesan) => {
        if (pesan.hasOwnProperty('_')) {
            if (pesan._.hasOwnProperty('pengirim')) {
                proses(pesan);
            }
        }
    });
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
