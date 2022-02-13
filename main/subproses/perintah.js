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
const cheerio = require('cheerio');

//////////////////// VARS

const creds = JSON.parse(fs.readFileSync('./creds.json'));
const admin = creds.tg_admin_id;
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

async function rss(rss) {
    if (rss.items) {
        await Promise.allSettled(
            rss.items.map((v) =>
                kirimPesan(rss.c, {
                    gambar: v.image ? { url: v.image } : undefined,
                    teks: `RSS Feed 📰 | ${v.title}${v.desc ? '\n\n' + v.desc : ''}\n\n${v.link}`,
                })
            )
        );
    } else if (rss.fail) {
        const errId = Math.random().toString(36).slice(2).toUpperCase();
        cache.data.errors ||= {};
        cache.data.errors[errId] = {
            $: $,
            e: rss.fail.reason,
            t: Date.now(),
        };
        kirimPesan(rss.c, {
            teks: TEKS['en']['rss/fail'].replace('%link', rss.fail.link).replace('%err', errId),
            saran: ['/addrss ' + rss.fail.link, '/report ' + errId],
        });
    }
}

async function proses(pesan) {
    log(1, pesan);
    logPesan(pesan.d, pesan._);
    const c = (await DB.cari({ _id: pesan._.pengirim })).hasil;
    const u = pesan._.pengirim !== pesan._.uid ? (await DB.cari({ _id: pesan._.uid })).hasil : c;
    const data = {
        c: c,
        u: u,
        i: u?.bindto ? (await DB.cari({ _id: u?.bindto })).hasil : null,
    };

    const system = (await DB.cari({ _id: 'system' })).hasil;
    if (!system) await DB.buat({ _id: 'system' });
    data.s = system ? system : {};

    const $ = pesan._;
    $.platform = pesan.d;
    $.bahasa = data.c?.lang || ($.pengirim.endsWith('#C') ? 0 : data.i?.lang) || 'id';
    $.TEKS = (teks) => TEKS[$.bahasa][teks];
    $.id = data.i ? data.i._id : null;
    if ($.platform === 'TG' && $.id && data.u.tg_name !== $.tg_name) {
        DB.perbarui({ _id: $.uid }, { $set: { tg_name: $.tg_name } });
    }

    if ($.pengirim.endsWith('#C')) {
        if (data.c) {
            if (data.c.ao) {
                if (!(await isAdmin($))) return;
            }
            if (data.c.gname !== $.gname) {
                DB.perbarui({ _id: $.pengirim }, { $set: { gname: $.gname } });
            }
        }
    }

    if ((data.c || data.i)?.ares) {
        for (const { t, r } of (data.c || data.i)?.ares) {
            if (new RegExp(`(\\s|^)${_.escapeRegExp(t)}(\\s|$)`, 'i')) {
                kirimPesan($.pengirim, { teks: r });
            }
        }
    }

    ////////// CHAT ID MIGRATE
    if ($.migrateChatID) {
        kirimPesan($.penerima, {
            teks: $.TEKS('system/migratedchatid'),
            saran: ['/registergroup', '/contacts admin'],
        });
    }
    ////////// ANONYMOUS CHAT
    else if (!$.pengirim.endsWith('#C') && cache.data.anch?.active?.includes?.($.uid)) {
        if (cache.data.broadcast?.length) await broadcast(pesan);
        anch(pesan, data);
    }
    ////////// INPUT
    else if (cache.data.waiter && cache.data.waiter[$.uid] && cache.data.waiter[$.uid]._in === $.pengirim) {
        if (cache.data.broadcast?.length) await broadcast(pesan);
        waiter($, data);
    }
    ////////// PERINTAH
    else if ($.teks && /^[\/\-\\><+_=|~!?@#$%^&\:.][a-zA-Z0-9]+\s*/.test($.teks)) {
        perintah(pesan, data);
    }
    ////////// BIND
    else if (!$.pengirim.endsWith('#C') && $.teks && $.teks.startsWith('bind:code=') && /^bind:code=[a-z0-9]+$/.test($.teks)) {
        if (cache.data.broadcast?.length) await broadcast(pesan);
        bind($, data);
    }
    ////////// SIMSIMI
    else if ((cache.data.simsimi ||= {})[$.pengirim]) {
        if (cache.data.broadcast?.length) await broadcast(pesan);
        simsimi($, data);
    }
}

async function broadcast(pesan) {
    const $ = pesan._;
    for (const b of cache.data.broadcast) {
        if (b.terjangkau.includes($.uid)) continue;
        await _kirimPesan($.pengirim, {
            teks: $.TEKS('command/broadcast/label') + b.teks,
            gambar: b.gambar ? { url: b.gambar } : undefined,
        });
        b.terjangkau.push($.uid);
    }
}

async function bind($, data) {
    for (const b of (cache.data.binds ||= [])) {
        if (Date.now() - b.time > 60000) {
            _.remove(cache.data.binds, { code: b.code });
            continue;
        }
        if (b.code === $.teks) {
            try {
                if ($.id) {
                    if (b.force) {
                        let h = await DB.perbarui({ _id: $.uid }, { $set: { bindto: b.id } });
                        if (h._e) throw h._e;
                        if ((await DB.cari({ bindto: $.id }, true)).hasil.filter((v) => v._id !== $.uid).length === 0) {
                            await DB.hapus({ _id: $.id });
                        }
                        return kirimPesan(b.uid, {
                            teks: $.TEKS('command/bind/success'),
                            saran: ['/bind'],
                        });
                    } else {
                        cache.data.binds.splice(_.findIndex(cache.data.binds, { code: b.code }), 1);
                        return kirimPesan(b.uid, {
                            teks: $.TEKS('command/bind/fail'),
                        });
                    }
                } else {
                    let h = await DB.buat({
                        _id: $.uid,
                        bindto: b.id,
                    });
                    if (h._e) throw h._e;
                    return kirimPesan(b.uid, {
                        teks: $.TEKS('command/bind/success'),
                        saran: ['/bind'],
                    });
                }
            } catch (e) {
                console.log(e);
                const errId = Math.random().toString(36).slice(2).toUpperCase();
                cache.data.errors ||= {};
                cache.data.errors[errId] = {
                    $: $,
                    e: e?.stack ?? e,
                    t: Date.now(),
                };
                kirimPesan(b.uid, {
                    teks: $.TEKS('system/error').replace('%e', errId),
                    saran: ['/report ' + errId],
                });
            }
        } else continue;
    }
}

async function simsimi($, data) {
    if (cache.data.simsimi[$.pengirim].expiration < Date.now()) {
        const limit = cekLimit($, data);
        if (cache.data.simsimi[$.pengirim].done > 0 && limit.val > 0) limit.kurangi();
        delete cache.data.simsimi[$.pengirim];
        return kirimPesan($.pengirim, { teks: $.TEKS('command/simsimi/off'), saran: ['/simsimi'] });
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
                        tg_no_remove_keyboard: true,
                    }).then((v) => resolve(v));
                }, _.random(0, 5000));
            });
            if (s === false) throw _e;
            cache.data.simsimi[$.pengirim].done++;
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
                saran: ['/report ' + errId],
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
            saran: ['/report ' + errId],
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
                kirimPesan(partner, { teks: $.TEKS('anonymouschat/partnerstoppeddialog'), saran: ['/asearch'] });
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
                    kirimPesan(partnerID, { teks: $.TEKS('anonymouschat/partnerfound'), saran: ['/anext', '/astop'] });
                    kirimPesan($.uid, { teks: $.TEKS('anonymouschat/partnerfound'), saran: ['/anext', '/astop'] });
                } else {
                    if (!cache.data.anch.ready) cache.data.anch.ready = [];
                    cache.data.anch.ready.push($.uid);
                    kirimPesan($.uid, { teks: $.TEKS('anonymouschat/findingpartner'), saran: ['/astop'] });
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
                kirimPesan($.uid, { teks: $.TEKS('anonymouschat/stoppingdialog'), saran: ['/asearch'] });
                kirimPesan(partner, { teks: $.TEKS('anonymouschat/partnerstoppeddialog'), saran: ['/asearch'] });
                return;
            }
        }

        let msg = {
            anch: {
                roomID: roomID,
            },
            re: $.q ? room.chat.filter((v) => v.includes($.q.mid))[0]?.filter?.((v) => v !== $.q.mid)?.[0] : undefined,
            tg_no_remove_keyboard: true,
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
                    if ($.q.stiker.animasi) {
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
            kirimPesan($.uid, {
                teks: $.TEKS('anonymouschat/sendingfailed'),
                tg_no_remove_keyboard: true,
            });
        }
        break;
    }
}

//////////////////// VALIDASI

async function validasiUser($, data) {
    let r = false;
    if (!cache.data.cdcmd) cache.data.cdcmd = {};
    const cdcmd = cache.data.cdcmd;
    if (!cdcmd[$.uid]) cdcmd[$.uid] = 0;
    if (!data.i || data.i.premlvl === 0 || Date.now() > data.i.expiration) {
        // FREE USER
        if (Date.now() - cdcmd[$.uid] < 5000)
            r = { teks: $.TEKS('user/freeusercdcommandreached').replace('%lvl', 'Free User').replace('%dur', '5'), saran: ['/pricing'] };
    } else {
        if (data.i.premlvl === 1) {
            // PREMIUM LITE
            if (Date.now() - cdcmd[$.uid] < 5000) r = { teks: $.TEKS('user/cdcommandreached').replace('%lvl', 'Premium Lite').replace('%dur', '5'), saran: ['/pricing'] };
        } else if (data.i.premlvl === 2) {
            // PREMIUM XTREME
        }
    }
    cdcmd[$.uid] = Date.now();
    for (const id in cdcmd) {
        if (Date.now() - cdcmd[id] > 10000) delete cdcmd[id];
    }
    return r;
}

function cekLimit($, data) {
    const now = Date.now();
    if (!cache.data.usrlimit) cache.data.usrlimit = { update: now };
    const usrlimit = cache.data.usrlimit;
    if (usrlimit.update < now - (now % 86_400_000)) cache.data.usrlimit = { update: now };
    return {
        val: cekPremium($, data) ? Infinity : usrlimit[$.id] ?? (usrlimit[$.id] = 2),
        kurangi: () => {
            if (!data.i?.premlvl && usrlimit[$.id || $.uid] > 0) {
                usrlimit[$.id || $.uid] -= 1;
                return kirimPesan($.pengirim, { teks: $.TEKS('user/limitnotice').replace('%lim', usrlimit[$.id || $.uid]), re: true, mid: $.mid, saran: ['/pricing'] });
            }
        },
        habis: { teks: $.TEKS('user/limitreached'), saran: ['/pricing'] },
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
            saran: ['/' + cmd],
        }),
        belum: (pesan) => ({
            ...pesan,
            tg_no_remove_keyboard: true,
        }),
        selesai: (pesan) => {
            delete cache.data.waiter[$.uid];
            return pesan;
        },
    };
}

function cekPremium($, data) {
    if (data.i?.premlvl) {
        if (data.i.expiration > Date.now()) return true;
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

    if (Perintah.hasOwnProperty($.perintah)) {
        stats.cmds($.perintah);
        if (cache.data.broadcast?.length) await broadcast(pesan);
        let r;
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
                saran: ['/report ' + errId],
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
                saran: ['/contacts', '/help', '/menu'],
            };
        },
    },
    anext: {
        stx: '/anext',
        cat: 'anonymouschat',
        fn: ($) => {
            return { teks: $.TEKS('anonymouschat/notinanyroom'), saran: ['/asearch'] };
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
                kirimPesan(partnerID, { teks: $.TEKS('anonymouschat/partnerfound'), saran: ['/anext', '/astop'] });
                return { teks: $.TEKS('anonymouschat/partnerfound'), saran: ['/anext', '/astop'] };
            } else {
                if (!cache.data.anch) cache.data.anch = {};
                if (!cache.data.anch.ready) cache.data.anch.ready = [];
                cache.data.anch.ready.push($.uid);
                return { teks: $.TEKS('anonymouschat/findingpartner'), saran: ['/astop'] };
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
            return { teks: $.TEKS('anonymouschat/notinanyroom'), saran: ['/asearch'] };
        },
    },
    audioonly: {
        stx: '/audioonly',
        cat: 'converter',
        fn: async ($, data) => {
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
                    saran: ['/menu', '/help'],
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
        stx: '/asahotak',
        cat: 'games',
        lang: ['id'],
        fn: async ($, data, { gamename, gamelink } = {}) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data[gamename || 'asahotak'] ||= await fetchJSON(gamelink || 'https://raw.githubusercontent.com/Veanyxz/json/main/game/asahotak.json');
            const soal = _.sample(cache.data[gamename || 'asahotak']);
            waiter.tambahkan($.pengirim, ['asahotak'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 3,
                gamename: gamename,
                _sessionName: gamename,
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal), saran: ['/cancel'] };
        },
        hd: (waiter, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    return waiter.selesai({
                        teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', waiter.val.jawaban),
                        saran: ['/' + (waiter.val.gamename || 'asahotak')],
                    });
                }
                if (new RegExp(waiter.val.jawaban).test($.teks.trim().toLowerCase())) {
                    return waiter.selesai({
                        teks: $.TEKS('command/$gamequestion/correct').replace('%ans', waiter.val.jawaban),
                        saran: ['/' + (waiter.val.gamename || 'asahotak')],
                    });
                } else {
                    if (--waiter.val.retries > 0) {
                        return waiter.belum({ teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', waiter.val.retries), saran: ['/cancel'] });
                    } else {
                        return waiter.selesai({
                            teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', waiter.val.jawaban),
                            saran: ['/' + (waiter.val.gamename || 'asahotak')],
                        });
                    }
                }
            } else {
                return waiter.notice('/cancel', waiter.val.gamename || 'asahotak');
            }
        },
    },
    caklontong: {
        stx: '/caklontong ',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data.caklontong ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/caklontong.json');
            const soal = _.sample(cache.data.caklontong);
            waiter.tambahkan($.pengirim, ['caklontong'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                deskripsi: soal.deskripsi,
                retries: 3,
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', soal.soal), saran: ['/cancel'] };
        },
        hd: (waiter, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    return waiter.selesai({
                        teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`),
                        saran: ['/caklontong'],
                    });
                }
                if (new RegExp(waiter.val.jawaban).test($.teks.trim().toLowerCase())) {
                    return waiter.selesai({
                        teks: $.TEKS('command/$gamequestion/correct').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`),
                        saran: ['/caklontong'],
                    });
                } else {
                    if (--waiter.val.retries > 0) {
                        return waiter.belum({ teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', waiter.val.retries), saran: ['/cancel'] });
                    } else {
                        return waiter.selesai({
                            teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', `${waiter.val.jawaban}\n${waiter.val.deskripsi}`),
                            saran: ['/caklontong'],
                        });
                    }
                }
            } else {
                return waiter.notice('/cancel', 'caklontong');
            }
        },
    },
    siapakahaku: {
        stx: '/siapakahaku',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            return await Perintah.asahotak.fn($, {}, { gamename: 'siapakahaku', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/siapakahaku.json' });
        },
    },
    susunkata: {
        stx: '/susunkata',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            cache.data.susunkata ||= await fetchJSON('https://raw.githubusercontent.com/Veanyxz/json/main/game/susunkata.sjon');
            const soal = _.sample(cache.data.susunkata);
            waiter.tambahkan($.pengirim, ['asahotak'], {
                jawaban: soal.jawaban.trim().toLowerCase(),
                retries: 3,
                gamename: 'susunkata',
                _sessionName: 'susunkata',
            });
            return { teks: $.TEKS('command/$gamequestion/start').replace('%q', `${soal.soal} (${soal.tipe})`), saran: ['/cancel'] };
        },
    },
    tebaklirik: {
        stx: '/tebaklirik',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            return await Perintah.asahotak.fn($, {}, { gamename: 'tebaklirik', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaklirik.json' });
        },
    },
    tebaktebakan: {
        stx: '/tebaktebakan',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            return await Perintah.asahotak.fn(
                $,
                {},
                { gamename: 'tebaktebakan', gamelink: 'https://raw.githubusercontent.com/Veanyxz/json/main/game/tebaktebakan.json' }
            );
        },
    },
    getgroupid: {
        stx: '/getGroupID',
        cat: 'bot',
        fn: ($, data) => {
            return { teks: data.c?.id || $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
        },
    },
    getuserid: {
        stx: '/getUserID',
        cat: 'bot',
        fn: ($) => {
            return { teks: $.id || $.TEKS('command/getuserid/null'), saran: $.id ? undefined : ['/register ' + $.name, '/menu bot'] };
        },
    },
    help: {
        stx: '/help',
        cat: 'bot',
        fn: ($) => {
            return {
                teks: $.TEKS('command/help'),
                saran: ['/menu'],
            };
        },
    },
    start: {
        stx: '/start',
        cat: 'bot',
        fn: ($) => {
            return {
                teks: $.TEKS('command/start'),
                saran: ['/about', '/help', '/menu', '/contacts'],
            };
        },
    },
    kbbi: {
        stx: '/KBBI [q]',
        cat: 'searchengine',
        lang: ['id'],
        fn: async ($) => {
            if (!$.arg) return { teks: $.TEKS('command/kbbi'), saran: ['/menu searching', '/help'] };
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
                    saran: ['/menu tools', '/help'],
                };
            }
        },
    },
    menu: {
        stx: '/menu',
        cat: 'bot',
        fn: ($) => {
            const a = $.argumen.replace(/[^a-z]/gi, '').toLowerCase();
            const b = (c) => ({ teks: $.TEKS('command/menu/' + c), tg_no_remove_keyboard: true });
            if (
                a === 'anonymouschat' ||
                a === 'shop' ||
                a === 'multiaccount' ||
                a === 'converter' ||
                a === 'fun' ||
                a === 'downloader' ||
                a === 'information' ||
                a === 'searching' ||
                a === 'tools' ||
                a === 'randomimage' ||
                a === 'game' ||
                a === 'reaction' ||
                a === 'rss' ||
                a === 'bot'
            )
                return b(a);
            else
                return {
                    teks: $.TEKS('command/menu'),
                    saran: [
                        '/start',
                        '/help',
                        ..._.shuffle([
                            '/menu anonymouschat',
                            '/menu shop',
                            '/menu multiaccount',
                            '/menu converter',
                            '/menu fun',
                            '/menu downloader',
                            '/menu information',
                            '/menu searching',
                            '/menu tools',
                            '/menu randomimage',
                            '/menu game',
                            '/menu reaction',
                            '/menu rss',
                            '/menu bot',
                        ]),
                    ],
                };
        },
    },
    pricing: {
        stx: '/pricing',
        cat: 'bot',
        fn: ($) => {
            return { teks: $.TEKS('command/pricing'), gambar: { url: 'https://telegra.ph/file/dc4bee30e0ef93a9ef44e.jpg' }, saran: ['/contacts'] };
        },
    },
    contacts: {
        stx: '/contacts',
        cat: 'bot',
        fn: ($) => {
            return {
                teks: $.TEKS('command/contacts'),
            };
        },
    },
    register: {
        stx: '/register [name]',
        cat: 'bot',
        fn: async ($, data) => {
            if ($.id) return { teks: $.TEKS('command/register/alreadyregistered'), saran: ['/setname', '/getuserid'] };
            if (!$.argumen || $.argumen.length > 25) return { teks: $.TEKS('command/register'), saran: ['/register ' + $.name, '/menu bot', '/help'] };
            const id = 'U-' + Math.random().toString(36).slice(2).toUpperCase();
            let h = await DB.buat({
                _id: id,
                join: Date.now(),
                name: $.argumen,
            });
            if (h._e) throw h._e;
            h = await DB.buat({
                _id: $.uid,
                bindto: id,
            });
            if (h._e) {
                await DB.hapus({ _id: id });
                throw h._e;
            }
            return { teks: $.TEKS('command/register/done').replace('%name', $.argumen).replace('%id', id).replace('%date', new Date().toLocaleString()) };
        },
    },
    registergroup: {
        stx: '/registergroup',
        cat: 'bot',
        fn: async ($, data) => {
            if (!$.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/grouponly') };
            if (data.c) return { teks: $.TEKS('command/registergroup/alreadyregistered'), saran: ['/getgroupid'] };
            const id = 'G-' + Math.random().toString(36).slice(2).toUpperCase();
            let h = await DB.buat({
                _id: $.pengirim,
                join: Date.now(),
                id: id,
            });
            if (h._e) throw h._e;
            return { teks: $.TEKS('command/registergroup/done').replace('%id', id).replace('%date', new Date().toLocaleString()) };
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
                    saran: ['/menu tools', '/help'],
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
    },
    setname: {
        stx: '/setname [name]',
        cat: 'bot',
        fn: async ($, data) => {
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.argumen || $.argumen.length > 25) return { teks: $.TEKS('command/setname'), saran: ['/setname ' + $.name, '/menu bot', '/help'] };
            const { _e } = await DB.perbarui({ _id: $.id }, { $set: { name: $.argumen } });
            if (_e) throw _e;
            return { teks: $.TEKS('command/setname/done').replace('%old', data.i.name).replace('%new', $.argumen), saran: ['/myprofile'] };
        },
    },
    setlanguage: {
        stx: '/setlanguage [lc]',
        cat: 'bot',
        fn: async ($, data) => {
            if ($.pengirim.endsWith('#C')) {
                if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
                if (!(await isAdmin($))) return { teks: $.TEKS('permission/adminonly') };
            } else {
                if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            }
            const langs = Object.keys(TEKS);
            if (!$.args[0]) return { teks: $.TEKS('command/setlanguage') };
            $.args[0] = $.args[0].toLowerCase();
            if (!langs.includes($.args[0])) return { teks: $.TEKS('command/command/setlanguage'), saran: ['/languages', '/menu bot', '/help'] };
            const { _e } = await DB.perbarui({ _id: $.pengirim.endsWith('#C') ? $.pengirim : $.id }, { $set: { lang: $.args[0] } });
            if (_e) throw _e;
            return { teks: TEKS[$.args[0]]['command/setlanguage/done'].replace('%lang', $.args[0]) };
        },
    },
    languages: {
        stx: '/languages',
        cat: 'bot',
        fn: ($) => {
            const languages = Object.keys(TEKS);
            return {
                teks: $.TEKS('command/languages'),
                saran: _.shuffle(languages).map((v) => `/setlanguage ${v.toUpperCase()}`),
            };
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
            else return { teks: $.TEKS('command/setpremiumuser/notfound') };
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
            if ($.gambar || $.q?.gambar) {
                const gambar = $.gambar || $.q?.gambar;
                if (gambar.ukuran > 1_500_000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                const { file, _e } = await unduh($.pengirim, gambar);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, 'jpg', $.argumen || '', creds.lolHumanAPIkey);
                return { stiker: { file: _webp } };
            } else if ($.video || $.q?.video) {
                const video = $.video || $.q?.video;
                if (video.ukuran > 1_500_000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                const { file, _e } = await unduh($.pengirim, video);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, 'mp4', $.argumen || '', creds.lolHumanAPIkey);
                return { stiker: { file: _webp } };
            } else if ($.dokumen || $.q?.dokumen) {
                const dokumen = $.dokumen || $.q?.dokumen;
                if (dokumen.ukuran > 1_500_000) return { teks: $.TEKS('command/sticker/sizetoolarge') };
                if (!['jpg', 'png', 'gif', 'mp4', 'webp', 'mpeg', 'avi', 'ogv', 'webm', '3gp'].includes(dokumen.eks))
                    return { teks: $.TEKS('command/sticker/documentnotsupported') };
                const { file, _e } = await unduh($.pengirim, dokumen);
                if (_e) throw _e;
                let _webp = await webp.keWebp(file, dokumen.eks, $.argumen || '', creds.lolHumanAPIkey);
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
                if (stiker.tg_animated_sticker) return { teks: $.TEKS('command/unsticker/animatedstickertelegramnotsupported') };
                if (stiker.animasi) {
                    const { file, _e } = await unduh($.pengirim, stiker);
                    if (_e) throw _e;
                    let output = await webp.keMp4(file, creds.lolHumanAPIkey);
                    return { video: { file: output, gif: true } };
                } else {
                    const { file, _e } = await unduh($.pengirim, stiker);
                    if (_e) throw _e;
                    const output = await webp.kePng(file, creds.lolHumanAPIkey);
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
                    saran: ['/menu tools', '/help'],
                };
            }
        },
    },
    google: {
        stx: '/google [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/google'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI('gsearch', 'query=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return { teks: res.result.map((v) => `• ${v.title}\n${v.link}\n${v.desc}`).join('\n\n') };
        },
    },
    playstore: {
        stx: '/playstore [q]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/playstore'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/youtube'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/ytaudio'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.)?youtu(\.be|be\.com)/.test($.argumen)) return { teks: $.TEKS('command/ytaudio'), saran: ['/menu downloader', '/help'] };
            $.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen;
            const res = await (await lolHumanAPI('ytaudio', 'url=' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            try {
                const { file, size } = await saveFetchByStream(await fetch(res.result.link.link), 'mp3', ukuranMaksimal.dokumen[$.platform]);
                if (size < ukuranMaksimal.audio[$.platform])
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
    ytaudio2: {
        stx: '/ytaudio2 [link]',
        cat: 'downloader',
        fn: async ($, data, o = {}) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            const CMD = o.command || 'ytaudio2',
                REGLINK = o.regexlink || /^(https?:\/\/)?(www\.)?youtu(\.be|be\.com)/,
                EXT = o.extension || 'mp3';
            const FILTER = o.filter || ((v) => v.extension === EXT);
            if (!$.argumen) return { teks: $.TEKS('command/' + CMD), saran: ['/menu downloader', '/help'] };
            if (!REGLINK.test($.argumen)) return { teks: $.TEKS('command/' + CMD), saran: ['/menu downloader', '/help'] };
            $.argumen = /^(https?:\/\/)/.test($.argumen) ? $.argumen : 'https://' + $.argumen;
            const { medias } = await aioVideoDl($.argumen);
            const mp3s = medias.filter(FILTER);
            if (!mp3s.length) return { teks: $.TEKS('command/' + CMD + '/notfound') };
            if (mp3s.length === 1) {
                return await Perintah.ytaudio2.hd({ url: mp3s[0].url, size: mp3s[0].size }, $, data, o);
            }
            waiter.tambahkan($.pengirim, ['ytaudio2'], {
                link: mp3s.map((v) => ({
                    url: v.url,
                    size: v.size,
                    quality: v.quality,
                })),
                o: o,
            });
            return {
                teks: $.TEKS('command/' + CMD + '/result').replace('%r', mp3s.map((v) => `/${v.quality} => ${v.quality.toUpperCase()}`).join('\n')),
                saran: ['/cancel', ...mp3s.map((v) => '/' + v.quality)],
            };
        },
        hd: async (waiter, $, data, o = {}) => {
            if (!o.command) o = waiter.val.o;
            const MIME = o.mimetype || 'audio/mp3',
                EXT = o.extension || 'mp3',
                MEDIA = o.media || 'audio',
                CMD = o.command || 'ytaudio2';
            async function download(link, size) {
                try {
                    if (size > ukuranMaksimal.dokumen[$.platform]) throw 'toobig';
                    const { file, size: _size } = await saveFetchByStream(await fetch(link), EXT, ukuranMaksimal.dokumen[$.platform]);
                    if (size < ukuranMaksimal[MEDIA][$.platform])
                        return {
                            [MEDIA]: { file: file },
                            _limit: cekLimit($, data),
                        };
                    return {
                        dokumen: { file: file, mimetype: MIME, namaFile: file },
                        _limit: cekLimit($, data),
                    };
                } catch (e) {
                    if (e === 'toobig')
                        return {
                            teks: $.TEKS('command/$filetoobig').replace('%l', await getShortLink(link)),
                        };
                    throw e;
                }
            }
            if (waiter.url && waiter.size) {
                return await download(waiter.url, waiter.size);
            }
            if ($.perintah && waiter.val.link.find((v) => v.quality === $.perintah)) {
                const { url, size, quality } = waiter.val.link.find((v) => v.quality === $.perintah);
                return waiter.selesai(await download(url, size));
            } else if ($.perintah === 'cancel') {
                return waiter.selesai({ teks: $.TEKS('user/dialogcancelled').replace('%d', CMD) });
            } else {
                return waiter.notice('cancel', CMD);
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
            if (!$.argumen) return { teks: $.TEKS('command/ytvideo'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.)?youtu(\.be|be\.com)/.test($.argumen)) return { teks: $.TEKS('command/ytvideo'), saran: ['/menu downloader', '/help'] };
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
    ytvideo2: {
        stx: '/ytvideo2 [link]',
        cat: 'downloader',
        fn: async ($, data) => {
            return Perintah.ytaudio2.fn($, data, {
                command: 'ytvideo2',
                extension: 'mp4',
                mimetype: 'video/mp4',
                media: 'video',
                filter: (v) => v.extension === 'mp4' && v.audioAvailable === true,
            });
        },
    },
    jadwaltv: {
        stx: '/jadwaltv [channel]',
        cat: 'information',
        lang: ['id'],
        fn: async ($) => {
            if (!$.args[0]) return { teks: $.TEKS('command/jadwaltv'), saran: ['/menu information', '/help'] };
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
        stx: '/acaratv',
        cat: 'information',
        lang: ['id'],
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
            if (!/^(https?:\/\/)?(www\.|m\.|web\.|mbasic\.)?(facebook|fb)\.(com|watch)/.test($.argumen))
                return { teks: $.TEKS('command/fbvideo'), saran: ['/menu downloader', '/help'] };
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
        stx: '/cerpen',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('cerpen')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: `${res.result.title}\n\nKarangan: ${res.result.creator}\n\n\t${res.result.cerpen}`,
            };
        },
    },
    pantun: {
        stx: '/pantun',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/pantun')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    puisi: {
        stx: '/puisi',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/puisi')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    faktaunik: {
        stx: '/faktaunik',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            const res = await (await lolHumanAPI('random/faktaunik')).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    ceritahoror: {
        stx: '/ceritahoror',
        cat: 'fun',
        lang: ['id'],
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
            if (!$.argumen) return { teks: $.TEKS('command/googleimage'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/pinterest'), saran: ['/menu searching', '/help'] };
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
        stx: '/katabijak [q]',
        cat: 'searchengine',
        lang: ['id'],
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/katabijak'), saran: ['/menu searching', '/help'] };
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
                let { file } = await saveFetchByStream(f, 'gif');
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
                let { file } = await saveFetchByStream(f, 'gif');
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
            if (!$.argumen) return { teks: $.TEKS('command/anime'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/manga'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/animangachar'), saran: ['/menu searching', '/help'] };
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
                    saran: ['/anime ' + res.result.title_english],
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
                    saran: ['/manga ' + res.result[0].title],
                };
            } else {
                return {
                    teks: $.TEKS('command/whatmanga/nomedia'),
                };
            }
        },
    },
    otakudesu: {
        stx: '/otakudesu [q/url]',
        cat: 'searchengine',
        lang: ['id'],
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/otakudesu'), saran: ['/menu searching', '/help'] };
            let res;
            if (/^(https?:\/\/)?(www\.)?otakudesu\.moe\//.test($.argumen.trim())) {
                res = await (await lolHumanAPI('otakudesu', 'url=' + encodeURI(($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen).trim()))).json();
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
        stx: '/kusonime [q/url]',
        cat: 'searchengine',
        lang: ['id'],
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/kusonime'), saran: ['/menu downloader', '/help'] };
            let res;
            if (/^(https?:\/\/)?(www\.)?kusonime\.com\//.test($.argumen.trim())) {
                res = await (await lolHumanAPI('kusonime', 'url=' + encodeURI(($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen).trim()))).json();
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
                _limit: limit,
            };
        },
    },
    lk21: {
        stx: '/lk21 [q]',
        cat: 'searchengine',
        lang: ['id'],
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/lk21'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/jooxdl'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.)?joox\.com\//.test($.argumen)) return { teks: $.TEKS('command/jooxdl'), saran: ['/menu downloader', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/spotify'), saran: ['/menu searching', '/help'] };
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
            if (!$.argumen) return { teks: $.TEKS('command/spotifydl'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.|open\.)?spotify\.com\//.test($.argumen)) return { teks: $.TEKS('command/spotifydl') };
            const res = await (await lolHumanAPI('spotify', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!$.argumen) return { teks: $.TEKS('command/twittervideo'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.)?twitter\.com\//.test($.argumen)) return { teks: $.TEKS('command/twittervideo'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('twitter2', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
                saran: ['/cancel', ...Object.keys(reso).map((v) => `/${v}`)],
            };
        },
        hd: async (waiter, $, data) => {
            if ($.perintah === 'cancel') {
                return waiter.selesai({ teks: $.TEKS('user/dialogcancelled').replace('%d', 'twittervideo') });
            } else {
                let link;
                if ((link = waiter.val[$.perintah])) {
                    const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                        ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                    const { file, size } = await saveFetchByStream(await fetch(link), 'mp4', ukuranDokumenMaksimal);
                    if (size < ukuranVideoMaksimal)
                        return waiter.selesai({
                            video: { file: file },
                            _limit: cekLimit($, data),
                        });
                    return waiter.selesai({
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                        _limit: cekLimit($, data),
                    });
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
            if (!$.argumen) return { teks: $.TEKS('command/instagramdl'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.)?instagram\.com\//.test($.argumen)) return { teks: $.TEKS('command/instagramdl'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('instagram', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
            if (res.status != 200) {
                res.result = (await aioVideoDl($.argumen)).medias.map((v) => v.url);
            }
            if (res.result.length === 1) {
                const f = await fetch(res.result[0]);
                if (f.headers.get('content-type') === 'video/mp4') {
                    const ukuranVideoMaksimal = ukuranMaksimal.video[$.platform],
                        ukuranDokumenMaksimal = ukuranMaksimal.dokumen[$.platform];
                    const { file, size } = await saveFetchByStream(f, 'mp4', ukuranDokumenMaksimal);
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
                    saran: ['/1', '/all', '/cancel'],
                };
            } else {
                throw 'nolink';
            }
        },
        hd: async (waiter, $, data) => {
            if ($.perintah === 'cancel') {
                return waiter.selesai({ teks: $.TEKS('user/dialogcancelled').replace('%d', 'instagramdl') });
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
                    if (size < ukuranVideoMaksimal)
                        return waiter.selesai({
                            video: { file: file },
                            _limit: cekLimit($, data),
                        });
                    return waiter.selesai({
                        dokumen: { file: file, mimetype: 'video/mp4', namaFile: res.result.title + '.mp4' },
                        _limit: cekLimit($, data),
                    });
                } else if (['image/jpeg', 'image/png'].includes(f.headers.get('content-type'))) {
                    const { file } = await saveFetchByStream(f, 'jpg');
                    return waiter.selesai({
                        gambar: { file: file },
                        _limit: cekLimit($, data),
                    });
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
            if (!$.argumen) return { teks: $.TEKS('command/tiktokvideo'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen)) return { teks: $.TEKS('command/tiktokvideo'), saran: ['/menu downloader', '/help'] };
            const f = await lolHumanAPI('tiktokwm', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen));
            if (f.status != 200) throw `${f.status} tiktokwm`;
            const { file } = await saveFetchByStream(f, 'mp4');
            return {
                video: { file: file },
                _limit: limit,
            };
        },
    },
    tiktokvideo2: {
        stx: '/tiktokvideo2 [link]',
        cat: 'downloader',
        fn: async ($, data) => {
            return Perintah.ytaudio2.fn($, data, {
                command: 'tiktokvideo2',
                extension: 'mp4',
                mimetype: 'video/mp4',
                media: 'video',
                filter: (v) => v.extension === 'mp4' && v.quality === 'watermark',
                regexlink: /^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//,
            });
        },
    },
    tiktokvideonowm: {
        stx: '/tiktokvideoNoWM [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/tiktokvideonowm'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen))
                return { teks: $.TEKS('command/tiktokvideonowm'), saran: ['/menu downloader', '/help'] };
            let link, res, e;
            const endpoints = _.shuffle(['tiktok', 'tiktok2', 'tiktok3']);
            for (const endpoint of endpoints) {
                e = endpoint;
                res = await (await lolHumanAPI(endpoint, 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
    tiktokvideonowm2: {
        stx: '/tiktokvideonowm2 [link]',
        cat: 'downloader',
        fn: async ($, data) => {
            return Perintah.ytaudio2.fn($, data, {
                command: 'tiktokvideonowm2',
                extension: 'mp4',
                mimetype: 'video/mp4',
                media: 'video',
                filter: (v) => v.extension === 'mp4' && v.quality === 'hd',
                regexlink: /^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//,
            });
        },
    },
    tiktokaudio: {
        stx: '/tiktokaudio [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen) return { teks: $.TEKS('command/tiktokaudio'), saran: ['/menu downloader', '/help'] };
            if (!/^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//.test($.argumen)) return { teks: $.TEKS('command/tiktokaudio'), saran: ['/menu downloader', '/help'] };
            const f = await lolHumanAPI('tiktokmusic', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen));
            if (f.status != 200) throw `${f.status} tiktokmusic`;
            const { file } = await saveFetchByStream(f, 'mp3');
            return {
                audio: { file: file },
                _limit: limit,
            };
        },
    },
    tiktokaudio2: {
        stx: '/tiktokaudio2 [link]',
        cat: 'downloader',
        fn: async ($, data) => {
            return Perintah.ytaudio2.fn($, data, {
                command: 'tiktokaudio2',
                extension: 'mp3',
                mimetype: 'audio/mp3',
                media: 'audio',
                filter: (v) => v.extension === 'mp3',
                regexlink: /^(https?:\/\/)?(www\.|(t|vt|vm)\.)?tiktok\.com\//,
            });
        },
    },
    mediafiredl: {
        stx: '/mediafiredl [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?mediafire\.com\//.test($.argumen)) return { teks: $.TEKS('command/mediafiredl'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('mediafire', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(www\d+\.)?zippyshare\.com\//.test($.argumen)) return { teks: $.TEKS('command/zippysharedl'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('zippyshare', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(\w+\.)?pinterest\.com\//.test($.argumen)) return { teks: $.TEKS('command/pinterestimage'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('pinterestdl', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(\w+\.)?pinterest\.com\//.test($.argumen)) return { teks: $.TEKS('command/pinterestvideo'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('pinterestvideo', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(www\.)?sharechat\.com\/video\//.test($.argumen))
                return { teks: $.TEKS('command/sharechatvideo'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('sharechat', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
    report: {
        stx: '/report [code]',
        cat: 'bot',
        fn: async ($) => {
            if (!$.args[0]) return { teks: $.TEKS('command/report'), saran: ['/menu bot', '/help'] };
            const error = cache.data.errors?.[$.args[0].toUpperCase()];
            if (!error) return { teks: $.TEKS('command/report/notfound'), saran: ['/contacts admin'] };
            const { _e } = await _kirimPesan(admin, {
                teks: `${new Date(error.t).toLocaleString()}\n\n${error.e}\n\n${JSON.stringify(error.$, null, '    ')}`,
            });
            if (_e) throw _e;
            return { teks: $.TEKS('command/report/done') };
        },
    },
    snackvideo: {
        stx: '/snackvideo [link]',
        cat: 'downloader',
        lim: true,
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!/^(https?:\/\/)?(www\.)?sck\.io\/p/.test($.argumen)) return { teks: $.TEKS('command/snackvideo'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('snackvideo', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(www\.)?smule\.com\//.test($.argumen)) return { teks: $.TEKS('command/smulevideo'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('smule', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(www\.)?smule\.com\//.test($.argumen)) return { teks: $.TEKS('command/smuleaudio'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('smule', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
            if (!/^(https?:\/\/)?(www\.)?(icocofun\.com|i\.coco\.fun)\//.test($.argumen))
                return { teks: $.TEKS('command/cocofun'), saran: ['/menu downloader', '/help'] };
            const res = await (await lolHumanAPI('cocofun', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
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
    simsimi: {
        stx: '/simsimi',
        cat: 'fun',
        lang: ['id'],
        lim: true,
        fn: async ($, data) => {
            if ($.pengirim.endsWith('#C')) {
                if (!(await isAdmin($))) return { teks: $.TEKS('permission/adminonly') };
            }
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            cache.data.simsimi ||= {};
            if (cache.data.simsimi[$.pengirim]) {
                if (cache.data.simsimi[$.pengirim].done > 0 && limit.val > 0) limit.kurangi();
                delete cache.data.simsimi[$.pengirim];
                return { teks: $.TEKS('command/simsimi/off'), saran: ['/simsimi'] };
            } else {
                cache.data.simsimi[$.pengirim] = {
                    initiator: $.uid,
                    expiration: data.i?.expiration || Date.now() + 60000 * 5,
                    done: 0,
                };
                return { teks: $.TEKS('command/simsimi/on'), saran: ['/simsimi'] };
            }
        },
    },
    berita: {
        stx: '/berita',
        cat: 'information',
        lang: ['id'],
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
        stx: '/1cak',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            return await Perintah.bts.fn($, data, { endpoint: 'onecak' });
        },
    },
    myprofile: {
        stx: '/myprofile',
        cat: 'bot',
        fn: async ($, data) => {
            return {
                teks: $.TEKS('command/myprofile')
                    .replace('%name', data.i?.name || $.TEKS('command/myprofile/unregistered'))
                    .replace('%id', $.id || $.TEKS('command/myprofile/unregistered'))
                    .replace('%reg', data.i?.join ? new Date(data.i.join).toLocaleString() : $.TEKS('command/myprofile/unregistered'))
                    .replace('%premstats', ['Free user', 'Premium Lite', 'Premium Xtreme'][data.i?.premlvl || 0] || $.TEKS('command/myprofile/unregistered'))
                    .replace('%expire', data.i?.expiration ? new Date(data.i.expiration).toLocaleString() : '-')
                    .replace('%count', $.id ? (await DB.cari({ bindto: $.id }, true)).hasil?.length - 1 || '-' : '-'),
            };
        },
    },
    bind: {
        stx: '/bind',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if ($.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/privateonly') };
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!cekPremium($, data) && (await DB.cari({ bindto: $.id }, true)).hasil?.filter?.((v) => v._id !== $.uid)?.length > 3)
                return { teks: $.TEKS('command/bind/limit') };
            let force = false;
            if ($.argumen) {
                if ($.argumen !== 'FORCE') return;
                force = true;
            }
            const code = 'bind:code=' + Array.from({ length: 5 }, () => Math.random().toString(36).slice(2)).join('');
            if (cache.data.binds && (idx = _.findIndex(cache.data.binds, { uid: $.uid })) !== -1) {
                cache.data.binds.splice(idx, 1, {
                    code: code,
                    force: force,
                    id: $.id,
                    uid: $.uid,
                    time: Date.now(),
                });
            } else {
                (cache.data.binds ||= []).push({
                    code: code,
                    force: force,
                    id: $.id,
                    uid: $.uid,
                    time: Date.now(),
                });
            }
            return {
                teks: (force ? $.TEKS('command/bind/force') + '\n\n' : '') + $.TEKS('command/bind/code').replace('%code', code),
            };
        },
    },
    unbind: {
        stx: '/unbind',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if ($.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/privateonly') };
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.argumen) {
                return { teks: $.TEKS('command/unbind/notice') };
            } else {
                if ($.argumen === 'FORCE') {
                    const id = 'U-' + Math.random().toString(36).slice(2).toUpperCase();
                    let h = await DB.buat({
                        _id: id,
                        join: Date.now(),
                        name: data.i.name,
                    });
                    if (h._e) throw h._e;
                    h = await DB.perbarui({ _id: $.uid }, { $set: { bindto: id } });
                    if (h._e) {
                        await DB.hapus({ _id: id });
                        throw h._e;
                    }
                    if ((await DB.cari({ bindto: $.id }, true)).hasil.filter((v) => v._id !== $.uid).length === 0) {
                        await DB.hapus({ _id: $.id });
                    }
                    return { teks: $.TEKS('command/unbind/success').replace('%old', $.id).replace('%new', id) };
                } else {
                    return;
                }
            }
        },
    },
    boundlist: {
        stx: '/boundlist',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            const bound = (await DB.cari({ bindto: $.id }, true)).hasil?.filter?.((v) => v._id !== $.uid);
            return {
                teks: bound?.length
                    ? bound
                          .map(
                              (v, i) =>
                                  `${i + 1}. [${v._id.split('#')[0]}] ${
                                      v.tg_name ? v.tg_name : $.pengirim.endsWith('#C') ? v._id.split('#')[1].replace(/.{4}$/, '****') : v._id.split('#')[1]
                                  }`
                          )
                          .join('\n')
                    : $.TEKS('command/boundlist/notfound'),
                saran: bound?.length ? ['/bind'] : undefined,
            };
        },
    },
    forward: {
        stx: '/forward [n/all]',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.q) return { teks: $.TEKS('command/forward'), saran: ['/boundlist', '/forward all', '/menu multiaccount', '/help'] };
            const bound = (await DB.cari({ bindto: $.id }, true)).hasil?.filter?.((v) => v._id !== $.uid);
            if (!bound.length) return { teks: $.TEKS('command/forward/notbound'), saran: ['/bind', '/menu multiaccount'] };
            let idx;
            if ($.args[0]?.toLowerCase?.() === 'all') {
                const res = await Promise.allSettled(bound.map((v) => forward(v._id)));
                const fulfilled = res.filter((v) => v.status === 'fulfilled');
                const rejected = res.filter((v) => v.status === 'rejected');
                const errors = rejected.filter((v) => v.reason !== 'notsupported');
                const notsupported = rejected.filter((v) => v.reason === 'notsupported');
                let errId;
                if (errors.length) {
                    errId = Math.random().toString(36).slice(2).toUpperCase();
                    cache.data.errors ||= {};
                    cache.data.errors[errId] = {
                        $: $,
                        e: rejected
                            .map((v) => {
                                let er = v.reason?.stack ?? v.reason;
                                if (String(er) === '[object Object]') {
                                    er = JSON.stringify(er);
                                }
                                return er;
                            })
                            .join('\n=============\n'),
                        t: Date.now(),
                    };
                }
                return {
                    teks: $.TEKS('command/forward/done')
                        .replace('%a', bound.length)
                        .replace('%s', fulfilled.length)
                        .replace('%f', errors.length ? `${errors.length} (${errId})` : '0')
                        .replace('%n', notsupported.length),
                    saran: errId ? ['/report ' + errId] : undefined,
                };
            } else if (!isNaN((idx = parseInt($.argumen))) && idx > 0 && idx <= bound.length) {
                try {
                    await forward(bound[idx - 1]._id);
                    return { teks: $.TEKS('command/forward/done').replace('%a', '1').replace('%s', '1').replace('%f', '0').replace('%n', '0') };
                } catch (e) {
                    if (e === 'notsupported') return { teks: $.TEKS('command/forward/done').replace('%a', '1').replace('%s', '0').replace('%f', '0').replace('%n', '1') };
                    throw e;
                }
            } else {
                return { teks: $.TEKS('command/forward'), saran: ['/boundlist', '/forward all', '/menu multiaccount', '/help'] };
            }

            async function forward(tujuan) {
                const msg = {};
                if ($.uid.startsWith('WA')) {
                    if (tujuan.startsWith('WA')) {
                        msg.copy = {
                            q: $.mid,
                        };
                    } else if (tujuan.startsWith('TG')) {
                        if ($.q.gambar) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.gambar });
                            msg.gambar = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.video) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.video });
                            msg.video = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.stiker) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.stiker });
                            if ($.q.stiker.animasi) {
                                const gif = await webp.keGif(file.file);
                                msg.video = {
                                    file: gif,
                                    gif: true,
                                };
                            } else {
                                msg.stiker = { file: file.file };
                            }
                        } else if ($.q.lokasi) {
                            msg.lokasi = $.q.lokasi;
                        } else if ($.q.audio) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.audio });
                            msg.audio = { file: file.file };
                        } else if ($.dokumen) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.dokumen });
                            msg.dokumen = { file: file.file, mimetype: $.q.dokumen.mimetype, namaFile: $.q.dokumen.namaFile };
                            msg.teks = `[[ ${$.q.dokumen.namaFile} ]]`;
                        } else if ($.q.kontak) {
                            msg.kontak = $.q.kontak;
                        } else {
                            if ($.q.teks) {
                                msg.teks = $.q.teks;
                            } else {
                                throw 'notsupported';
                            }
                        }
                    }
                } else if ($.uid.startsWith('TG')) {
                    if (tujuan.startsWith('TG')) {
                        msg.copy = {
                            from: $.uid,
                            mid: $.q.mid,
                        };
                    } else if (tujuan.startsWith('WA')) {
                        if ($.q.gambar) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.gambar });
                            msg.gambar = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.video) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.video });
                            msg.video = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.stiker) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.stiker });
                            msg.stiker = { file: file.file };
                        } else if ($.q.lokasi) {
                            msg.lokasi = $.q.lokasi;
                        } else if ($.q.audio) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.audio });
                            msg.audio = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.dokumen && $.q.dokumen.ukuran < ukuranMaksimal.dokumen.WA) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.dokumen });
                            msg.dokumen = {
                                file: file.file,
                                mimetype: $.q.dokumen.mimetype,
                                namaFile: $.q.dokumen.namaFile,
                            };
                            msg.teks = $.q.teks;
                        } else if ($.q.kontak) {
                            msg.kontak = $.q.kontak;
                        } else {
                            if ($.q.teks) {
                                msg.teks = $.q.teks;
                            } else {
                                throw 'notsupported';
                            }
                        }
                    }
                }

                const { s, _e } = await _kirimPesan(tujuan, msg);
                if (s === false) {
                    throw _e;
                }
            }
        },
    },
    groupstatus: {
        stx: '/groupstatus',
        cat: 'bot',
        fn: async ($, data) => {
            if (!$.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/grouponly') };
            if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
            return {
                teks: $.TEKS('command/groupstatus').replace('%join', new Date(data.c.join).toLocaleString()),
            };
        },
    },
    tebakgambar: {
        stx: '/tebakgambar',
        cat: 'games',
        lang: ['id'],
        fn: async ($) => {
            const waiter = cekWaiter($);
            if (waiter.val) return waiter.tolak();
            const endpoints = _.shuffle(['tebak/gambar', 'tebak/gambar2']);
            let res;
            for (const endpoint of endpoints) {
                res = await (await lolHumanAPI(endpoint)).json();
                if (res.status == 200) break;
            }
            if (res.status != 200) throw `${endpoints} ${res.message}`;
            const { s, _e } = await _kirimPesan($.pengirim, {
                gambar: { url: res.result.image },
                teks: $.TEKS('command/tebakgambar'),
                saran: ['/cancel'],
            });
            if (s === false) throw _e;
            waiter.tambahkan($.pengirim, ['tebakgambar'], {
                jawaban: res.result.answer.toLowerCase(),
                retries: 3,
            });
            return;
        },
        hd: async (waiter, $) => {
            if ($.teks) {
                if ($.perintah === 'cancel') {
                    return waiter.selesai({ teks: $.TEKS('command/$gamequestion/cancelled').replace('%ans', waiter.val.jawaban), saran: ['/tebakgambar'] });
                }
                if (new RegExp(waiter.val.jawaban).test($.teks.trim().toLowerCase())) {
                    return waiter.selesai({ teks: $.TEKS('command/$gamequestion/correct').replace('%ans', waiter.val.jawaban), saran: ['/tebakgambar'] });
                } else {
                    if (--waiter.val.retries > 0) {
                        return waiter.belum({ teks: $.TEKS('command/$gamequestion/tryagain').replace('%lives', waiter.val.retries), saran: ['/cancel'] });
                    } else {
                        return waiter.selesai({ teks: $.TEKS('command/$gamequestion/incorrect').replace('%ans', waiter.val.jawaban), saran: ['/tebakgambar'] });
                    }
                }
            } else {
                return waiter.notice('/cancel', 'tebakgambar');
            }
        },
    },
    delete: {
        stx: '/delete',
        cat: 'bot',
        fn: async ($) => {
            if (!$.q) return { teks: $.TEKS('command/delete/noreply') };
            if ($.platform === 'WA' && !$.q.me) return { teks: $.TEKS('command/delete/notme') };
            const { r } = await IPC.kirimKueri($.platform, {
                delmsg: {
                    cid: $.pengirim,
                    mid: $.q.mid,
                },
            });
            if (r) {
                if ($.platform === 'TG') {
                    IPC.kirimKueri($.platform, {
                        delmsg: {
                            cid: $.pengirim,
                            mid: $.mid,
                        },
                    });
                }
                return;
            } else return { teks: $.TEKS('command/delete/fail') };
        },
    },
    apakah: {
        stx: '/apakah',
        cat: 'fun',
        lang: ['id'],
        fn: ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/apakah'), saran: ['/menu fun', '/help'] };
            return { teks: _.sample($.TEKS('command/apakah/$answers').split('\n')) };
        },
    },
    bahasapurba: {
        stx: '/bahasapurba [text]',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data, { endpoint, name } = {}) => {
            if (!$.arg) return { teks: $.TEKS(name ? 'command/' + name : 'command/bahasapurba'), saran: ['/menu fun', '/help'] };
            const res = await (await lolHumanAPI(endpoint || 'bahasapurba', 'text=' + encodeURI($.arg))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    bahasajaksel: {
        stx: '/bahasajaksel [text]',
        cat: 'fun',
        lang: ['id'],
        fn: async ($, data) => {
            return Perintah.bahasapurba.fn($, data, { endpoint: 'randombahasa', name: 'bahasajaksel' });
        },
    },
    growtopia: {
        stx: '/growtopia',
        cat: 'information',
        fn: async ($) => {
            const res = await (await lolHumanAPI('growtopia')).json();
            if (res.status != 200) throw res.message;
            return {
                gambar: { url: res.result.wotd.preview },
                teks: $.TEKS('command/growtopia').replace('%wotd', res.result.wotd.name).replace('%onl', res.result.player_online),
            };
        },
    },
    osu: {
        stx: '/osu [username]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/osu'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI('osuname/' + encodeURI($.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: Object.entries(res.result)
                    .map((v) => v.join(': '))
                    .join('\n'),
            };
        },
    },
    heroml: {
        stx: '/heroml [hero]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.argumen) return { teks: $.TEKS('command/heroml'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI('heroml/' + encodeURI($.argumen))).json();
            if (res.status == 404) return { teks: $.TEKS('command/heroml/notfound') };
            if (res.status != 200) throw res.message;
            return {
                gambar: res.result.icon ? { url: res.result.icon } : undefined,
                teks: `${res.result.hero_name.toUpperCase()}\n\n"${res.result.ent_quotes}"\n\n${Object.entries(res.result.detail)
                    .map((v) => v.join(': '))
                    .join('\n')}\n\n${Object.entries(res.result.attr)
                    .map((v) => v.join(': '))
                    .join('\n')}`,
            };
        },
    },
    mlusername: {
        stx: '/mlusername [id] [serverid]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!($.args[0] && $.args[1])) return { teks: $.TEKS('command/mlusername'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI(`mobilelegend/${encodeURI($.args[0])}/${encodeURI($.args[1])}`)).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    ffusername: {
        stx: '/ffusername [id]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!$.args[0]) return { teks: $.TEKS('command/ffusername'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI(`freefire/${encodeURI($.args[0])}`)).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    pubgusername: {
        stx: '/pubgusername [id]',
        cat: 'searchengine',
        fn: async ($) => {
            if (!($.args[0] && $.args[1])) return { teks: $.TEKS('command/pubgusername'), saran: ['/menu searching', '/help'] };
            const res = await (await lolHumanAPI(`pubg/${encodeURI($.args[0])}/${encodeURI($.args[1])}`)).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
            };
        },
    },
    addrss: {
        stx: '/addRSS [link]',
        cat: 'rss',
        lim: true,
        fn: async ($, data) => {
            if (!cekPremium($, data)) return { teks: $.TEKS('permission/premiumonly'), saran: ['/pricing'] };
            if ($.pengirim.endsWith('#C') && !data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
            if (!$.pengirim.endsWith('#C') && !$.id)
                return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.args[0]) return { teks: $.TEKS('command/addrss'), saran: ['/menu rss', '/help'] };
            const url = $.args[0].startsWith('http') ? $.args[0] : 'https://' + $.args[0];
            if (data.c?.rss?.includes?.(url)) return { teks: $.TEKS('command/rss/duplicate'), saran: ['/rsslist'] };
            try {
                new URL(url);
            } catch {
                return { teks: $.TEKS('command/addrss'), saran: ['/menu rss', '/help'] };
            }
            const { h, _e } = IPC.kirimKueri('RS', {
                add: [url, $.pengirim],
            });
            if (_e) {
                if (_e === 'notfeed') return { teks: $.TEKS('command/addrss/notfeed'), saran: ['/menu rss', '/help'] };
                else throw _e;
            }
            return { teks: $.TEKS('command/addrss/done'), saran: ['/rsslist'] };
        },
    },
    rsslist: {
        stx: '/RSSlist',
        cat: 'rss',
        lim: true,
        fn: async ($, data) => {
            if (!cekPremium($, data)) return { teks: $.TEKS('permission/premiumonly'), saran: ['/pricing'] };
            if (!data.c?.rss) return { teks: $.TEKS('command/rsslist/notfound'), saran: ['/addrss', '/menu rss'] };
            return {
                teks: data.c.rss.map((v, i) => `${i + 1}. ${v}`).join('\n'),
            };
        },
    },
    deleterss: {
        stx: '/deleteRSS',
        cat: 'rss',
        lim: true,
        fn: async ($) => {
            if (!cekPremium($, data)) return { teks: $.TEKS('permission/premiumonly'), saran: ['/pricing'] };
            if (!$.args[0] || isNaN(parseInt($.args[0]))) return { teks: $.TEKS('command/deleterss'), saran: ['/menu rss', '/help', '/rsslist'] };
            const idx = parseInt($.args[0]) - 1;
            const { h, l, _e } = await IPC.kirimKueri('RS', {
                del: [idx, $.pengirim],
            });
            if (_e) {
                if (_e === 'outofindex') return { teks: $.TEKS('command/deleterss'), saran: ['/menu rss', '/help', '/rsslist'] };
                else throw _e;
            }
            return { teks: $.TEKS('command/deleterss/done').replace('%link', l) };
        },
    },
    addgroup: {
        stx: '/addgroup',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if (!$.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/grouponly') };
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
            if (!(await isOwner($))) return { teks: $.TEKS('permission/owneronly') };
            if (!cekPremium($, data) && data.i.groups?.length > 3) return { teks: $.TEKS('command/addgroup/limit') };
            const { _e } = await DB.perbarui({ _id: $.id }, { $push: { groups: data.c.id } });
            if (_e) throw _e;
            return { teks: $.TEKS('command/addgroup/done') };
        },
    },
    grouplist: {
        stx: '/grouplist',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!data.i.groups?.length) return { teks: $.TEKS('command/grouplist/notfound'), saran: ['/addgroup', '/menu multiaccount'] };
            const groups = [];
            for (const [idx, gid] of Object.entries(data.i.groups)) {
                groups.push(`${+idx + 1}. ${(await DB.cari({ id: gid }))?.hasil?.gname || v}`);
            }
            return { teks: groups.join('\n') };
        },
    },
    deletegroup: {
        stx: '/deletegroup [n]',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.args[0] || isNaN(parseInt($.args[0])) || parseInt($.args[0]) < 1 || parseInt($.args[0]) > data.i.groups?.length)
                return { teks: $.TEKS('command/deletegroup'), saran: ['/menu multiaccount', '/help', '/grouplist'] };
            const idx = parseInt($.args[0]);
            const { _e } = await DB.perbarui({ _id: $.id }, { $pull: { groups: data.i.groups[idx - 1] } });
            if (_e) throw _e;
            return { teks: $.TEKS('command/deletegroup/done').replace('%id', (await DB.cari({ id: data.i.groups[idx - 1] }))?.hasil?.gname || data.i.groups[idx - 1]) };
        },
    },
    forwardgroup: {
        stx: '/forwardgroup [n/all]',
        cat: 'multiplatformtools',
        fn: async ($, data) => {
            if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot', '/menu multiaccount'] };
            if (!$.q) return { teks: $.TEKS('command/forwardgroup'), saran: ['/grouplist', '/forwardgroup all', '/menu multiaccount', '/help'] };
            if (!data.i.groups?.length) return { teks: $.TEKS('command/forwardgroup/notfound'), saran: ['/addgroup', '/menu multiaccount'] };
            const tujuan = [];
            for (const gid of data.i.groups) {
                tujuan.push((await DB.cari({ id: gid }))?.hasil?._id);
            }
            let idx;
            if ($.args[0]?.toLowerCase?.() === 'all') {
                const res = await Promise.allSettled(tujuan.map((v) => forward(v)));
                const fulfilled = res.filter((v) => v.status === 'fulfilled');
                const rejected = res.filter((v) => v.status === 'rejected');
                const errors = rejected.filter((v) => v.reason !== 'notsupported');
                const notsupported = rejected.filter((v) => v.reason === 'notsupported');
                let errId;
                if (errors.length) {
                    errId = Math.random().toString(36).slice(2).toUpperCase();
                    cache.data.errors ||= {};
                    cache.data.errors[errId] = {
                        $: $,
                        e: rejected.map((v) => v.reason?.stack ?? v.reason).join('\n=============\n'),
                        t: Date.now(),
                    };
                }
                return {
                    teks: $.TEKS('command/forwardgroup/done')
                        .replace('%a', tujuan.length)
                        .replace('%s', fulfilled.length)
                        .replace('%f', errors.length ? `${errors.length} (${errId})` : '0')
                        .replace('%n', notsupported.length),
                    saran: errId ? ['/report ' + errId] : undefined,
                };
            } else if (!isNaN((idx = parseInt($.argumen))) && idx > 0 && idx <= tujuan.length) {
                try {
                    await forward(tujuan[idx - 1]);
                    return { teks: $.TEKS('command/forwardgroup/done').replace('%a', '1').replace('%s', '1').replace('%f', '0').replace('%n', '0') };
                } catch (e) {
                    if (e === 'notsupported')
                        return { teks: $.TEKS('command/forwardgroup/done').replace('%a', '1').replace('%s', '0').replace('%f', '0').replace('%n', '1') };
                    throw e;
                }
            } else {
                return { teks: $.TEKS('command/forwardgroup'), saran: ['/grouplist', '/forwardgroup all', '/menu multiaccount', '/help'] };
            }

            async function forward(tujuan) {
                const msg = {};
                if ($.uid.startsWith('WA')) {
                    if (tujuan.startsWith('WA')) {
                        msg.copy = {
                            q: $.mid,
                        };
                    } else if (tujuan.startsWith('TG')) {
                        if ($.q.gambar) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.gambar });
                            msg.gambar = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.video) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.video });
                            msg.video = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.stiker) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.stiker });
                            if ($.q.stiker.animasi) {
                                const gif = await webp.keGif(file.file);
                                msg.video = {
                                    file: gif,
                                    gif: true,
                                };
                            } else {
                                msg.stiker = { file: file.file };
                            }
                        } else if ($.q.lokasi) {
                            msg.lokasi = $.q.lokasi;
                        } else if ($.q.audio) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.audio });
                            msg.audio = { file: file.file };
                        } else if ($.dokumen) {
                            const file = await IPC.kirimKueri('WA', { unduh: $.q.dokumen });
                            msg.dokumen = { file: file.file, mimetype: $.q.dokumen.mimetype, namaFile: $.q.dokumen.namaFile };
                            msg.teks = `[[ ${$.q.dokumen.namaFile} ]]`;
                        } else if ($.q.kontak) {
                            msg.kontak = $.q.kontak;
                        } else {
                            if ($.q.teks) {
                                msg.teks = $.q.teks;
                            } else {
                                throw 'notsupported';
                            }
                        }
                    }
                } else if ($.uid.startsWith('TG')) {
                    if (tujuan.startsWith('TG')) {
                        msg.copy = {
                            from: $.uid,
                            mid: $.q.mid,
                        };
                    } else if (tujuan.startsWith('WA')) {
                        if ($.q.gambar) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.gambar });
                            msg.gambar = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.video) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.video });
                            msg.video = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.stiker) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.stiker });
                            msg.stiker = { file: file.file };
                        } else if ($.q.lokasi) {
                            msg.lokasi = $.q.lokasi;
                        } else if ($.q.audio) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.audio });
                            msg.audio = { file: file.file };
                            msg.teks = $.q.teks;
                        } else if ($.q.dokumen && $.q.dokumen.ukuran < ukuranMaksimal.dokumen.WA) {
                            const file = await IPC.kirimKueri('TG', { unduh: $.q.dokumen });
                            msg.dokumen = {
                                file: file.file,
                                mimetype: $.q.dokumen.mimetype,
                                namaFile: $.q.dokumen.namaFile,
                            };
                            msg.teks = $.q.teks;
                        } else if ($.q.kontak) {
                            msg.kontak = $.q.kontak;
                        } else {
                            if ($.q.teks) {
                                msg.teks = $.q.teks;
                            } else {
                                throw 'notsupported';
                            }
                        }
                    }
                }

                const { s, _e } = await _kirimPesan(tujuan, msg);
                if (s === false) {
                    throw _e;
                }
            }
        },
    },
    broadcast: {
        stx: '/broadcast [text]',
        cat: 'dev',
        fn: async ($) => {
            if (!cekDev($.uid)) return;
            let gambar;
            if ($.gambar || $.q?.gambar) {
                const { file, _e } = await unduh($.pengirim, $.gambar || $.q?.gambar);
                if (_e) throw _e;
                gambar = await uploadGambar(file);
            } else {
                if (!$.arg) return { teks: 'err: text' };
            }
            cache.data.broadcast ||= [];
            const id = cache.data.broadcast.push({
                teks: $.arg,
                gambar: gambar,
                terjangkau: [],
            });
            return {
                teks: $.TEKS('command/broadcast/done')
                    .replace('%id', id)
                    .replace('%img', gambar || '-')
                    .replace('%txt', $.arg || '-'),
                saran: ['/broadcastlist'],
            };
        },
    },
    broadcastlist: {
        stx: '/broadcastlist',
        cat: 'dev',
        fn: ($) => {
            if (!cekDev($.uid)) return;
            return {
                teks: cache.data.broadcast
                    ?.map?.((v, i) => `${i + 1}. Broadcast${i + 1}\n${v.terjangkau.length} ${$.TEKS('command/broadcastlist/peoplereached')}`)
                    ?.join?.('\n\n'),
            };
        },
    },
    deletebroadcast: {
        stx: '/deletebroadcast [n]',
        cat: 'dev',
        fn: ($) => {
            if (!cekDev($.uid)) return;
            const n = parseInt($.args[0]);
            if (isNaN(n) || n <= 0 || n > cache.data.broadcast?.length || 0) return { teks: 'err: index' };
            cache.data.broadcast.splice(n - 1, 1);
            return { teks: $.TEKS('command/deletebroadcast/done').replace('%id', n) };
        },
    },
    bypassouo: {
        stx: '/bypassouo [link]',
        cat: 'tools',
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen || !/^(https?:\/\/)?ouo\.io\//.test($.argumen)) return { teks: $.TEKS('command/bypassouo') };
            const res = await (await lolHumanAPI('ouo', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: res.result,
                _limit: limit,
            };
        },
    },
    bypassmirroredto: {
        stx: '/bypassmirroredto [link]',
        cat: 'tools',
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if (!$.argumen || !/^(https?:\/\/)?(www\.)?mirrored\.to\//.test($.argumen)) return { teks: $.TEKS('command/bypassmirroredto') };
            const res = await (await lolHumanAPI('mirrorcreator', 'url=' + encodeURI($.argumen.startsWith('http') ? $.argumen : 'https://' + $.argumen))).json();
            if (res.status != 200) throw res.message;
            return {
                teks: Object.entries(res.result)
                    .map((v) => v.join(': '))
                    .join('\n'),
                _limit: limit,
            };
        },
    },
    ocr: {
        stx: '/ocr',
        cat: 'tools',
        fn: async ($, data) => {
            const limit = cekLimit($, data);
            if (limit.val === 0) return limit.habis;
            if ($.gambar || $.q?.gambar) {
                const { file } = await unduh($.pengirim, $.gambar || $.q.gambar);
                const { size } = await fsp.stat(file);
                const form = new FormData();
                const stream = fs.createReadStream(file);
                form.append('img', stream, { knownLength: size });
                const res = await (await postToLolHumanAPI('ocr', form)).json();
                if (res.status != 200) throw res.message;
                return {
                    teks: res.result,
                    _limit: limit,
                };
            } else {
                return {
                    teks: $.TEKS('command/$noimage'),
                };
            }
        },
    },
    setadminonly: {
        stx: '/setadminonly',
        cat: 'bot',
        fn: async ($, data) => {
            if (!$.pengirim.endsWith('#C')) return { teks: $.TEKS('permission/grouponly') };
            if (!(await isAdmin($))) return { teks: $.TEKS('permission/adminonly') };
            if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
            if (data.c.ao) {
                const { _e } = await DB.perbarui({ id: data.c.id }, { $unset: { ao: 1 } });
                if (_e) throw _e;
                return { teks: $.TEKS('command/setadminonly/off'), saran: ['/setadminonly'] };
            } else {
                const { _e } = await DB.perbarui({ id: data.c.id }, { $set: { ao: 1 } });
                if (_e) throw _e;
                return { teks: $.TEKS('command/setadminonly/on'), saran: ['/setadminonly'] };
            }
        },
    },
    addautoresponse: {
        stx: '/addautoresponse [trigger] | [response]',
        cat: 'bot',
        fn: async ($, data) => {
            let id;
            if ($.pengirim.endsWith('#C')) {
                if (!(await isAdmin($))) return { teks: $.TEKS('permission/adminonly') };
                if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
                id = { id: data.c.id };
            } else {
                if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot'] };
                id = { _id: $.id };
            }
            if (!$.argumen) return { teks: $.TEKS('command/addautoresponse'), saran: ['/menu bot', '/help'] };
            let [trigger, ...response] = $.argumen.split('|');
            trigger = trigger.trim();
            response = response.join('|').trim();
            if (!trigger || !response) return { teks: $.TEKS('command/addautoresponse'), saran: ['/menu bot', '/help'] };
            if (($.pengirim.endsWith('#C') ? data.c : data.i)?.ares?.find?.((v) => v.t === trigger))
                return { teks: $.TEKS('command/addautoresponse/duplicate'), saran: ['/autoresponselist'] };
            const { _e } = await DB.perbarui(id, { $push: { ares: { t: trigger, r: response } } });
            if (_e) throw _e;
            return { teks: $.TEKS('command/addautoresponse/done').replace('%f', trigger).replace('%r', response), saran: ['/autoresponselist'] };
        },
    },
    autoresponselist: {
        stx: '/autoresponselist',
        cat: 'bot',
        fn: async ($, data) => {
            const data = $.pengirim.endsWith('#C') ? data.c : data.i;
            return {
                teks: data?.ares?.map?.((v, i) => `${i + 1}. ${v.t}`)?.join?.('\n'),
                saran: ['/addautoresponse', '/deleteautoresponse'],
            };
        },
    },
    deleteautoresponse: {
        stx: '/deleteautoresponse',
        cat: 'bot',
        fn: async ($, data) => {
            let id;
            if ($.pengirim.endsWith('#C')) {
                if (!(await isAdmin($))) return { teks: $.TEKS('permission/adminonly') };
                if (!data.c) return { teks: $.TEKS('permission/registeredgrouponly'), saran: ['/registergroup', '/menu bot'] };
                id = { id: data.c.id };
            } else {
                if (!$.id) return { teks: $.TEKS('permission/registeredonly'), saran: ['/register ' + $.name, '/menu bot'] };
                id = { _id: $.id };
            }
            if (!$.argumen || isNaN(parseInt($.argumen))) return { teks: $.TEKS('command/deleteautoresponse'), saran: ['/autoresponselist', '/menu bot', '/help'] };
            const data = $.pengirim.endsWith('#C') ? data.c : data.i,
                idx = parseInt($.argumen);
            if (!data?.ares?.length) return { teks: $.TEKS('command/deleteautoresponse/notfound'), saran: ['/addautoresponse'] };
            if (idx <= 0 || idx > data.ares.length) return { teks: $.TEKS('command/deleteautoresponse'), saran: ['/autoresponselist', '/menu bot', '/help'] };
            const q = data.ares.length === 1 ? { $unset: { ares: 1 } } : { $pull: { ares: { t: data.ares[idx - 1].t } } };
            const { _e } = await DB.perbarui(id, q);
            if (_e) throw _e;
            return { teks: $.TEKS('command/deleteautoresponse/done').replace('%f', data.ares[idx - 1].t), saran: ['/autoresponselist'] };
        },
    },
};

// thanks to XFar
async function aioVideoDl(link) {
    const html = await (
        await fetch('https://aiovideodl.ml/', {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                cookie: 'PHPSESSID=3893d5f173e91261118a1d8b2dc985c3; _ga=GA1.2.792478743.1635388171;',
            },
        })
    ).text();
    const token = cheerio.load(html)('#token').attr('value');
    const res = await (
        await fetch('https://aiovideodl.ml/wp-json/aio-dl/video-data/?url=' + encodeURIComponent(link.trim()) + '&token=' + token, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                cookie: 'PHPSESSID=3893d5f173e91261118a1d8b2dc985c3; _ga=GA1.2.792478743.1635388171;',
            },
        })
    ).json();
    return res;
}

const stats = {
    cmds: (cmd) => {
        return IPC.kirimSinyal('ST', {
            c: [Date.now(), cmd],
        });
    },
};

async function uploadGambar(file) {
    let form = new FormData();
    form.append('file', fs.createReadStream(file));
    let res = await fetch('https://telegra.ph/upload', {
        method: 'POST',
        body: form,
    });
    if (res.status != 200) throw res.status;
    let img = await res.json();
    if (img.error) throw img.error;
    return 'https://telegra.ph' + img[0].src;
}

async function isAdmin($) {
    return (await IPC.kirimKueri($.platform, { isAdmin: { c: $.pengirim, u: $.uid } })).admin;
}

async function isOwner($) {
    return (await IPC.kirimKueri($.platform, { isOwner: { c: $.pengirim, u: $.uid } })).owner;
}

function saveFetchByStream(res, ext, maxSize) {
    return new Promise((resolve, reject) => {
        if (ext === 'mp4' && res.headers.get('content-type') !== 'video/mp4') {
            res.body?.close?.();
            return reject('not a video');
        }
        if (ext === 'mp3' && !['audio/mp3', 'audio/mp4', 'audio/mpeg'].includes(res.headers.get('content-type'))) {
            res.body?.close?.();
            return reject('not an audio');
        }
        if (maxSize && +res.headers.get('content-length') > maxSize) {
            res.body?.close?.();
            reject('toobig');
        }
        const filename = `./tmp/${utils.namaFileAcak()}.${ext}`;
        const stream = fs.createWriteStream(filename);
        res.body.pipe(stream);
        let size = 0;
        res.body.on('data', (chunk) => {
            size += chunk.length;
            if (maxSize && size > maxSize) {
                res.body?.close?.();
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

const ukuranMaksimal = {
    dokumen: {
        WA: 100_000_000,
        TG: 50_000_000,
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
    return fetch(`https://api.lolhuman.xyz/api/${API}?apikey=${creds.lolHumanAPIkey}&${params.join('&')}`);
}

function postToLolHumanAPI(API, body, opts = {}) {
    return fetch(`https://api.lolhuman.xyz/api/${API}?apikey=${creds.lolHumanAPIkey}`, {
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
    for (const devId of creds.devids) {
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
        pesan.teks?.slice?.(0, 150) || ''
    );
}

////////////////////

process.on('message', async (pesan) => {
    IPC.terimaSinyal(pesan, (pesan) => {
        if (pesan.hasOwnProperty('_')) {
            if (pesan._.hasOwnProperty('pengirim')) {
                proses(pesan);
            } else if (pesan._?.rss) {
                rss(pesan._.rss);
            }
        }
    });
});

process.on('exit', () => fs.writeFileSync('./data/tmpdb.json', JSON.stringify(cache.data)));

function log(kode, ...argumen2) {
    if (!creds.dev) return;
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

if (creds.watch) {
    require('fs').watch(__filename, () => {
        log(7);
        process.exit();
    });
}
