const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const fsp = require('fs/promises');
const cp = require('child_process');
const util = require('util');
const _ = require('lodash');
const fetch = require('node-fetch');
const chalk = require('chalk');
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
        try {
            const cdw = cache.data.waiter[$.uid];
            const handler = cdw._handler;
            let r;
            if ((r = Perintah[handler[0]]?.hd || Perintah[handler[0]]?._?.[handler[1]]?.hd)) {
                if ($.teks && /^[\/\-\\><+_=|~!?@#$%^&.][a-zA-Z0-9]+\s*/.test($.teks)) {
                    const _perintah = $.teks.split(/\s+/)[0];
                    $.argumen = $.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
                    $.perintah = _perintah.slice(1).toLowerCase();
                    $.arg = $.argumen || $.q?.teks || '';
                    $.args = $.argumen.split(/\s+/);
                }
                r = await r(cdw, $, data);
                if (r) return kirimPesan($.pengirim, { ...r, re: true, mid: $.mid });
            }
        } catch (e) {
            console.log(e);
            return kirimPesan($.pengirim, { teks: $.TEKS('system/error').replace('%e', e), re: true, mid: $.mid });
        }
    }
    ////////// PERINTAH
    else if ($.teks) {
        if (/^[\/\-\\><+_=|~!?@#$%^&.][a-zA-Z0-9]+\s*/.test($.teks)) {
            return perintah(pesan, data);
        } else {
            log(3, $.teks);
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
    if (!data.u || data.u.premlvl === 0 || Date.now() > +data.u.expiration) {
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
        val: data.u?.premlvl !== 0 ? 999 : usrlimit[$.uid] ?? (usrlimit[$.uid] = 3),
        kurangi: () => {
            if (data.u?.premlvl === 0 && usrlimit[$.uid] > 0) {
                usrlimit[$.uid] -= 1;
                return kirimPesan($.pengirim, { teks: $.TEKS('user/limitnotice').replace('%lim', usrlimit[$.uid]), re: true, mid: $.mid });
            }
        },
        habis: { teks: $.TEKS('user/limitreached') },
    };
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
        if ((r = await validasiUser($, $.uid, data))) return kirimPesan($.pengirim, { ...r, re: true, mid: $.mid });

        const msg = {
            penerima: $.pengirim,
            mid: $.mid,
            re: true,
        };
        try {
            const res = await Perintah[$.perintah].fn($, data);
            if (!res) return;
            const hasil = {
                ...msg,
                ...res,
            };
            log(5, hasil);
            logPesan(pesan.d, hasil, true);
            let { _e } = await _kirimPesan($.pengirim, hasil);
            if (_e) throw _e;
        } catch (e) {
            log(6, $.teks);
            console.error(e);
            const errId = Math.random().toString(36).slice(2);
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
            return {
                teks: $.TEKS('command/setgroupsubscription/done')
                    .replace('%id', id)
                    .replace('%date', new Date(perpanjang ? cdata.expiration + +durasi : Date.now() + +durasi)),
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
        fn: async ($) => {
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
            return { dokumen: { file: output, mimetype: 'audio/mp3', namaFile: media.namaFile ? media.namaFile + '.mp3' : output.replace('./tmp/', '') } };
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
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game asahotak') };
            cache.data.asahotak ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/asahotak.json');
            const soal = _.sample(cache.data.asahotak);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['asahotak'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', wdata.jawaban) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', wdata.jawaban) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', wdata.jawaban) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/asahotak') };
            }
        },
    },
    caklontong: {
        stx: '/caklontong (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game caklontong') };
            cache.data.caklontong ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/caklontong.json');
            const soal = _.sample(cache.data.caklontong);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['caklontong'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                deskripsi: soal.deskripsi,
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', `${wdata.jawaban}\n${wdata.deskripsi}`) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', `${wdata.jawaban}\n${wdata.deskripsi}`) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', `${wdata.jawaban}\n${wdata.deskripsi}`) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/caklontong') };
            }
        },
    },
    siapakahaku: {
        stx: '/siapakahaku (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game siapakahaku') };
            cache.data.siapakahaku ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/siapakahaku.json');
            const soal = _.sample(cache.data.siapakahaku);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['siapakahaku'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', wdata.jawaban) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', wdata.jawaban) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', wdata.jawaban) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/siapakahaku') };
            }
        },
    },
    susunkata: {
        stx: '/susunkata (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game susunkata') };
            cache.data.susunkata ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/susunkata.sjon');
            const soal = _.sample(cache.data.susunkata);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['susunkata'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', `${soal.soal} (${soal.tipe})`) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', wdata.jawaban) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', wdata.jawaban) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', wdata.jawaban) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/susunkata') };
            }
        },
    },
    tebaklirik: {
        stx: '/tebaklirik (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game tebaklirik') };
            cache.data.tebaklirik ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaklirik.json');
            const soal = _.sample(cache.data.tebaklirik);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['tebaklirik'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', wdata.jawaban) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', wdata.jawaban) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', wdata.jawaban) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/tebaklirik') };
            }
        },
    },
    tebaktebakan: {
        stx: '/tebaktebakan (Indonesia)',
        cat: 'games',
        fn: async ($) => {
            if ((cache.data.waiter ||= {})[$.uid]) return { teks: $.TEKS('user/inanothersession').replace('%session', '/game tebaktebakan') };
            cache.data.tebaktebakan ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaktebakan.json');
            const soal = _.sample(cache.data.tebaktebakan);
            cache.data.waiter[$.uid] = {
                _in: $.pengirim,
                _handler: ['tebaktebakan'],
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 5,
            };
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal) };
        },
        hd: (wdata, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', wdata.jawaban) };
                }
                if (new RegExp(wdata.jawaban).test($.teks.trim().toLowerCase())) {
                    delete cache.data.waiter[$.uid];
                    return { teks: $.TEKS('command/$gamequestion/correct').replace('%ans', wdata.jawaban) };
                } else {
                    if (--wdata.retries > 0) {
                        return { teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', wdata.retries) };
                    } else {
                        delete cache.data.waiter[$.uid];
                        return { teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', wdata.jawaban) };
                    }
                }
            } else {
                return { teks: $.TEKS('user/dialognotice').replace('%cmd', '/cancel').replace('%d', '/tebaktebakan') };
            }
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
            const res = await (await lolHumanAPI('ytaudio', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return await new Promise((resolve, reject) => {
                fetch(res.result.link.link)
                    .then((_res) => {
                        const filename = './tmp/' + utils.namaFileAcak() + '.mp3';
                        const stream = fs.createWriteStream(filename);
                        _res.body.pipe(stream);
                        let size = 0,
                            ukuranAudioMaksimal = ukuranMaksimal.audio[$.platform],
                            ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                        _res.body.on('data', async (chunk) => {
                            size += chunk.length;
                            if (size > ukuranDokumenMaksimal) {
                                _res.body.close();
                                resolve({
                                    teks: $.TEKS('command/ytaudio/toobig')
                                        .replace('%alink', await getShortLink(res.result.link.link))
                                        .replace('%asize', res.result.link.size)
                                        .replace('%ares', res.result.link.bitrate + 'kb/s'),
                                });
                            }
                        });
                        _res.body.on('end', () => {
                            limit.kurangi();
                            if (size < ukuranAudioMaksimal) {
                                resolve({
                                    audio: { file: filename },
                                    teks: res.result.title,
                                });
                            } else {
                                resolve({
                                    dokumen: { file: filename, mimetype: 'audio/mp3', namaFile: res.result.title + '.mp3' },
                                });
                            }
                        });
                        stream.on('error', reject);
                    })
                    .catch(reject);
            });
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
            const res = await (await lolHumanAPI('ytvideo', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return await new Promise((resolve, reject) => {
                fetch(res.result.link.link)
                    .then((_res) => {
                        const filename = './tmp/' + utils.namaFileAcak() + '.mp4';
                        const stream = fs.createWriteStream(filename);
                        _res.body.pipe(stream);
                        let size = 0,
                            ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                            ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                        _res.body.on('data', async (chunk) => {
                            size += chunk.length;
                            if (size > ukuranDokumenMaksimal) {
                                _res.body.close();
                                resolve({
                                    teks: $.TEKS('command/ytvideo/toobig')
                                        .replace('%vlink', await getShortLink(res.result.link.link))
                                        .replace('%vsize', res.result.link.size)
                                        .replace('%vres', res.result.link.resolution),
                                });
                            }
                        });
                        _res.body.on('end', () => {
                            limit.kurangi();
                            if (size < ukuranVideoMaksimal) {
                                resolve({
                                    video: { file: filename },
                                    teks: res.result.title,
                                });
                            } else {
                                resolve({
                                    dokumen: { file: filename, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                                });
                            }
                        });
                        stream.on('error', reject);
                    })
                    .catch(reject);
            });
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
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            const res = await (await lolHumanAPI('jadwaltv/now')).json();
            if (res.status != 200) throw res.message;
            limit.kurangi();
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
            const res = await (await lolHumanAPI('facebook', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            if (!res.result) return { teks: $.TEKS('command/fbvideo/cantdownload') };
            return await new Promise((resolve, reject) => {
                fetch(res.result)
                    .then((_res) => {
                        const filename = './tmp/' + utils.namaFileAcak() + '.mp4';
                        const stream = fs.createWriteStream(filename);
                        _res.body.pipe(stream);
                        let size = 0,
                            ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                            ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                        _res.body.on('data', async (chunk) => {
                            size += chunk.length;
                            if (size > ukuranDokumenMaksimal) {
                                _res.body.close();
                                resolve({
                                    teks: $.TEKS('command/fbvideo/toobig').replace('%vlink', await getShortLink(res.result)),
                                });
                            }
                        });
                        _res.body.on('end', () => {
                            limit.kurangi();
                            if (size < ukuranVideoMaksimal) {
                                resolve({
                                    video: { file: filename },
                                });
                            } else {
                                resolve({
                                    dokumen: { file: filename, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                                });
                            }
                        });
                        stream.on('error', reject);
                    })
                    .catch(reject);
            });
        },
    },
};

//////////////////// FUNGSI PEMBANTU

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
