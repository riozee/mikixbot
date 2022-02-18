const utils = require('../../utils');
const IPC = new utils.IPC('TG', process);

const fsp = require('fs/promises');
const fs = require('fs');
const fetch = require('node-fetch');
const mime = require('mime-types');
const { Telegraf } = require('telegraf');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

const cache = {
    cekizin: {},
};

log(0);
const bot = new Telegraf(creds.tgtoken);

let bot_id, bot_username;
bot.telegram.getMe().then(({ id, username }) => {
    bot_id = id;
    bot_username = username;
});

bot.on('new_chat_members', (konteks) => {
    IPC.kirimSinyal('PR', {
        pengirim: IDChat(konteks.chat.id),
        gname: konteks.chat.title,
        welcome: konteks.update.message.new_chat_members.map((v) => (v.username ? '@' + v.username : v.first_name)),
    });
});

bot.on('left_chat_member', (konteks) => {
    IPC.kirimSinyal('PR', {
        pengirim: IDChat(konteks.chat.id),
        gname: konteks.chat.title,
        leave: [konteks.update.message.left_chat_member].map((v) => (v.username ? '@' + v.username : v.first_name)),
    });
});

bot.on('callback_query', (konteks) => {});

bot.on(['message', 'channel_post'], async (konteks) => {
    if (konteks.channelPost) {
        konteks = {
            message: {
                ...konteks.channelPost,
                from: konteks.channelPost.sender_chat,
                reply_to_message: konteks.channelPost.reply_to_message
                    ? {
                          ...konteks.channelPost.reply_to_message,
                          from: konteks.channelPost.reply_to_message.sender_chat,
                      }
                    : undefined,
            },
        };
    }
    log(1, konteks, konteks.message, konteks.message.from, konteks.message.chat);
    const uid = konteks.message.from.id;
    const cid = konteks.message.chat.id;

    if (!cache.cekizin[cid] || Date.now() - cache.cekizin[cid].t > 10000) {
        cache.cekizin[cid] = {
            t: Date.now(),
            p: await cekIzin(cid, konteks.message.chat.type === 'channel'),
        };
        console.log(cache.cekizin[cid]);
    }
    if (cache.cekizin[cid].p === 'n') return;
    const isChannel = konteks.message.chat.type === 'channel';
    const name = [konteks.message.from.first_name, konteks.message.from.last_name].filter(Boolean).join(' ');
    let pesan = {
        pengirim: isChannel ? IDChannel(cid) : uid == cid ? IDPengguna(uid) : IDChat(cid),
        uid: isChannel ? IDChannel(cid) : IDPengguna(uid),
        mid: konteks.message.message_id,
        tg_name: konteks.message.from.username ? '@' + konteks.message.from.username : konteks.message.sender_chat?.title || name,
        gname: uid != cid || isChannel ? konteks.message.chat.title : undefined,
        name: name,
    };

    function muatPesan(message) {
        const _ = {};

        const teks = message?.text || message?.caption;
        if (teks) _.teks = teks;

        if (message?.photo?.length) {
            const gambar = message.photo.reverse()[0];
            _.gambar = {
                id: gambar.file_id,
                eks: 'jpg',
                ukuran: gambar.file_size,
            };
        } else if (message?.sticker) {
            _.stiker = {
                id: message.sticker.is_animated ? message.sticker.thumb.file_id : message.sticker.file_id,
                eks: 'webp',
                ukuran: message.sticker.file_size,
                animasi: message.sticker.is_video,
                tg_animated_sticker: message.sticker.is_animated,
            };
        } else if (message?.video) {
            _.video = {
                id: message.video.file_id,
                eks: 'mp4',
                ukuran: message.video.file_size,
                durasi: message.video.duration * 1000,
            };
        } else if (message?.video_note) {
            _.video = {
                id: message.video_note.file_id,
                eks: 'mp4',
                ukuran: message.video_note.file_size,
                tg_video_note: true,
                durasi: message.video_note.duration * 1000,
            };
        } else if (message?.location) {
            _.lokasi = {
                lat: message.location.latitude,
                lon: message.location.longitude,
            };
        } else if (message?.audio) {
            _.audio = {
                id: message.audio.file_id,
                eks: 'mp3',
                ukuran: message.audio.file_size,
                durasi: message.audio.duration * 1000,
            };
        } else if (message?.document && !message?.animation) {
            const eks = message.document.file_name.split('.').reverse()[0] || '';
            _.dokumen = {
                id: message.document.file_id,
                eks: eks,
                ukuran: message.document.file_size,
                mimetype: mime.lookup(eks) || undefined,
                namaFile: message.document.file_name,
            };
        } else if (message?.contact) {
            _.kontak = [
                {
                    nama: message.contact.first_name + (message.contact.last_name ? ` ${message.contact.last_name}` : ''),
                    nomor: message.contact.phone_number,
                },
            ];
        } else if (message?.animation) {
            _.video = {
                id: message.animation.file_id,
                eks: 'mp4',
                ukuran: message.animation.file_size,
                gif: true,
                durasi: message.animation.duration * 1000,
            };
        }

        return _;
    }

    pesan = {
        ...pesan,
        ...muatPesan(konteks.message),
        mentioned: [],
    };

    if (konteks.message.reply_to_message) {
        pesan.q = muatPesan(konteks.message.reply_to_message);
        pesan.q.mid = konteks.message.reply_to_message.message_id;
        pesan.q.me = konteks.message.reply_to_message.from.id === bot_id;
    }

    if (konteks.message.reply_to_message?.from) {
        const k = konteks.message.reply_to_message.from;
        if (k.username) pesan.mentioned.push(k.username);
        else pesan.mentioned.push(k.first_name + (k.last_name ? ' ' + k.last_name : ''));
    }

    if (konteks.message.entities) {
        let r;
        if ((r = konteks.message.entities.find((v) => v.type === 'bot_command' && v.offset === 0))) {
            if ((r = pesan.teks.substr(r.offset, r.length)) && r.includes('@')) {
                const [command, username] = r.split('@');
                if (username !== bot_username) return;
                else pesan.teks = pesan.teks.replace(r, command);
            }
        }
        konteks.message.entities
            .filter((v) => v.type === 'mention' || v.type === 'text_mention')
            .map((v) => pesan.teks.substr(v.offset, v.length))
            .forEach((v) => pesan.mentioned.push(v));
    }
    if (konteks.message.caption_entities) {
        let r;
        if ((r = konteks.message.entities.find((v) => v.type === 'bot_command' && v.offset === 0))) {
            if ((r = pesan.teks.substr(r.offset, r.length)) && r.includes('@')) {
                const [command, username] = r.split('@');
                if (username !== bot_username) return;
                else pesan.teks = pesan.teks.replace(r, command);
            }
        }
        konteks.message.caption_entities
            .filter((v) => v.type === 'mention' || v.type === 'text_mention')
            .map((v) => pesan.teks.substr(v.offset, v.length))
            .forEach((v) => pesan.mentioned.push(v));
    }
    if (konteks.message.migrate_to_chat_id) {
        pesan.migrateChatID = {
            from: IDChat(konteks.message.migrate_from_chat_id),
            to: IDChat(konteks.message.migrate_to_chat_id),
        };
    }

    log(2, pesan);
    return IPC.kirimSinyal('PR', pesan);
});

bot.launch().then(() => log(3));

async function kirimPesan(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    let opsi = {};
    if (pesan._.re) {
        if (typeof pesan._.re === 'number') {
            opsi.reply_to_message_id = pesan._.re;
        } else {
            opsi.reply_to_message_id = pesan._.mid;
        }
    }
    if (!pesan._.penerima.endsWith('#H')) {
        if (pesan._.saran) {
            opsi.reply_markup = {
                keyboard: pesan._.saran.map((v) => [{ text: v }]),
                one_time_keyboard: true,
                resize_keyboard: true,
                selective: true,
            };
        } else {
            if (!pesan._.tg_no_remove_keyboard) {
                opsi.reply_markup = {
                    remove_keyboard: true,
                    selective: true,
                };
            }
        }
    }

    try {
        const $ = pesan._;
        let m, ids;
        //////////////////////////////// GAMBAR
        if ($.gambar && !Array.isArray($.gambar)) {
            if ($.teks) {
                const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                    teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                if ($.gambar.id) m = await bot.telegram.sendPhoto(penerima, $.gambar.id, { ...opsi, caption: teksAwal });
                else if ($.gambar.file) m = await bot.telegram.sendPhoto(penerima, { source: $.gambar.file }, { ...opsi, caption: teksAwal });
                else if ($.gambar.url) m = await bot.telegram.sendPhoto(penerima, { url: $.gambar.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.gambar.id) m = await bot.telegram.sendPhoto(penerima, $.gambar.id, opsi);
                else if ($.gambar.file) m = await bot.telegram.sendPhoto(penerima, { source: $.gambar.file }, opsi);
                else if ($.gambar.url) m = await bot.telegram.sendPhoto(penerima, { url: $.gambar.url }, opsi);
            }
        } else if (Array.isArray($.gambar)) {
            const media = [];
            const _m = {
                type: 'photo',
            };
            for (const gambar of $.gambar) {
                if (gambar.id)
                    media.push({
                        ..._m,
                        media: gambar.id,
                    });
                else if (gambar.file)
                    media.push({
                        ..._m,
                        media: { source: gambar.file },
                    });
                else if (gambar.url)
                    media.push({
                        ..._m,
                        media: { url: gambar.url },
                    });
            }
            m = await bot.telegram.sendMediaGroup(penerima, media);
        }

        //////////////////////////////// VIDEO
        else if ($.video) {
            if ($.video.gif) {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                        teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                    if ($.video.id) m = await bot.telegram.sendAnimation(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendAnimation(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendAnimation(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendAnimation(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendAnimation(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendAnimation(penerima, { url: $.video.url }, opsi);
                }
            } else if ($.video.tg_video_note) {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                        teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                    if ($.video.id) m = await bot.telegram.sendVideoNote(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendVideoNote(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendVideoNote(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendVideoNote(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendVideoNote(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendVideoNote(penerima, { url: $.video.url }, opsi);
                }
            } else {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                        teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                    if ($.video.id) m = await bot.telegram.sendVideo(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendVideo(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendVideo(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendVideo(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendVideo(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendVideo(penerima, { url: $.video.url }, opsi);
                }
            }
        }

        //////////////////////////////// STIKER
        else if ($.stiker) {
            if ($.stiker.id) m = await bot.telegram.sendSticker(penerima, $.stiker.id, { ...opsi });
            else if ($.stiker.file) m = await bot.telegram.sendSticker(penerima, { source: $.stiker.file }, { ...opsi });
            else if ($.stiker.url) m = await bot.telegram.sendSticker(penerima, { url: $.stiker.url }, { ...opsi });
        }

        //////////////////////////////// LOKASI
        else if ($.lokasi) {
            m = await bot.telegram.sendLocation(penerima, $.lokasi.lat, $.lokasi.lon, opsi);
        }

        //////////////////////////////// AUDIO
        else if ($.audio) {
            if ($.teks) {
                const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                    teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                if ($.audio.id) m = await bot.telegram.sendAudio(penerima, $.audio.id, { ...opsi, caption: teksAwal });
                else if ($.audio.file) m = await bot.telegram.sendAudio(penerima, { source: $.audio.file }, { ...opsi, caption: teksAwal });
                else if ($.audio.url) m = await bot.telegram.sendAudio(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.audio.id) m = await bot.telegram.sendAudio(penerima, $.audio.id, opsi);
                else if ($.audio.file) m = await bot.telegram.sendAudio(penerima, { source: $.audio.file }, opsi);
                else if ($.audio.url) m = await bot.telegram.sendAudio(penerima, { url: $.audio.url }, opsi);
            }
        }

        //////////////////////////////// DOKUMEN
        else if ($.dokumen) {
            opsi.file_name = $.namaFile || undefined;
            if ($.teks) {
                const teksAwal = $.teks.length > 1024 ? $.teks.slice(0, 1024) : $.teks,
                    teksSisa = $.teks.length > 1024 ? $.teks.slice(1024) : '';
                if ($.dokumen.id) m = await bot.telegram.sendDocument(penerima, $.dokumen.id, { ...opsi, caption: teksAwal });
                else if ($.dokumen.file) m = await bot.telegram.sendDocument(penerima, { source: $.dokumen.file }, { ...opsi, caption: teksAwal });
                else if ($.dokumen.url) m = await bot.telegram.sendDocument(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.dokumen.id) m = await bot.telegram.sendDocument(penerima, $.dokumen.id, opsi);
                else if ($.dokumen.file) m = await bot.telegram.sendDocument(penerima, { source: $.dokumen.file }, opsi);
                else if ($.dokumen.url) m = await bot.telegram.sendDocument(penerima, { url: $.dokumen.url }, opsi);
            }
        }

        //////////////////////////////// KONTAK
        else if ($.kontak) {
            ids = [];
            for await (const kntk of $.kontak) {
                const nomor = kntk.nomor || kntk.nama.replace(/\D+/g, '') || '000000000000';
                ids.push(
                    (
                        await bot.telegram.sendContact(penerima, nomor, kntk.nama, {
                            ...opsi,
                            vcard: `BEGIN:VCARD\nVERSION:2.1\nFN:${kntk.nama}\nTEL;CELL:${nomor}\nEND:VCARD`,
                        })
                    ).message_id
                );
            }
        }

        //////////////////////////////// ANONYMOUS CHAT FORWARD MESSAGE
        else if ($.copy) {
            m = await bot.telegram.copyMessage(penerima, ID($.copy.from), $.copy.mid, opsi);
        }

        //////////////////////////////// TEKS
        else {
            ids = await kirimPesanTeks(penerima, $.teks, opsi);
        }
        log(5);
        return { s: true, mid: m ? [m.message_id, ...(ids || [])] : ids };
    } catch (e) {
        log(6);
        console.error(e);
        const se = String(e);
        if (se.includes('need administrator rights') || se.includes('have no rights') || se.includes('blocked')) {
            cache.cekizin[cid] = {
                t: Date.now(),
                p: 'n',
            };
            return { s: false, _e: 'notallowed' };
        }
        return { s: false, _e: e };
    }
}

async function cekIzin(id, channel = false) {
    if (channel) {
        const admins = await bot.telegram.getChatAdministrators(id);
        return admins.filter((v) => v.user.id === bot_id)[0].can_post_messages ? 'a' : 'n';
    } else {
        try {
            const { permissions } = await bot.telegram.getChat(id);
            if (permissions) return permissions.can_send_messages ? 'a' : 'n';
            else return 'a';
        } catch (e) {
            if (String(e).includes('chat not found')) return 'n';
            else {
                console.error(e);
                return 'a';
            }
        }
    }
}

async function unduhMedia(media) {
    const [file_id, eks] = [media.id, media.eks];
    const tautan = (await bot.telegram.getFileLink(file_id)).href;
    const f = await fetch(tautan);
    const buffer = await f.buffer();
    const keluaran = `./tmp/${utils.namaFileAcak()}.${eks}`;
    await fsp.writeFile(keluaran, buffer);
    return keluaran;
}

process.on('message', (pesan) => {
    if (pesan.slice(0, -2).endsWith('i')) {
        IPC.terimaDanBalasKueri(pesan, async (pesan) => {
            if (pesan._?.penerima) {
                return await kirimPesan(pesan);
            } else if (pesan._?._eval) {
                return await utils.jalankanFn(() => eval(pesan._._eval));
            } else if (pesan._?.unduh) {
                return { file: await unduhMedia(pesan._.unduh) };
            } else if (pesan._?.isAdmin) {
                return {
                    admin: (await bot.telegram.getChatAdministrators(ID(pesan._.isAdmin.c))).map((v) => String(v.user.id)).includes(ID(pesan._.isAdmin.u)),
                };
            } else if (pesan._?.delmsg) {
                return { r: Boolean(await bot.telegram.deleteMessage(ID(pesan._.delmsg.cid), pesan._.delmsg.mid)) };
            } else if (pesan._?.isOwner) {
                return {
                    owner: await (async () => {
                        const id = ID(pesan._.isOwner.c);
                        const uid = ID(pesan._.isOwner.u);
                        const admins = await bot.telegram.getChatAdministrators(id);
                        if (admins.find((v) => String(v.user.id) === uid)?.status === 'creator') return true;
                        return false;
                    })(),
                };
            } else if (pesan._?.descGroup) {
                return {
                    desc: (await bot.telegram.getChat(ID(pesan._.descGroup))).description,
                };
            }
        });
    } else {
        IPC.terimaSinyal(pesan, async (pesan) => {
            if (pesan._?.penerima) {
                return await kirimPesan(pesan);
            }
        });
    }
});

function IDChat(ID) {
    return 'TG#' + ID + '#C';
}

function IDPengguna(ID) {
    return 'TG#' + ID;
}

function IDChannel(ID) {
    return 'TG#' + ID + '#H';
}

function ID(_ID) {
    return _ID.replace(/^TG#|#H$|#C$/, '');
}

async function kirimPesanTeks(penerima, teks, opsi) {
    const ids = [];
    if (teks.length === 0) ids.push((await bot.telegram.sendMessage(penerima, '-', opsi)).message_id);
    else
        for (const _teks of bagiString(teks, 4096)) {
            const terkirim = await bot.telegram.sendMessage(penerima, _teks, opsi);
            ids.push(terkirim.message_id);
        }
    return ids;
}

function bagiString(teks, besar) {
    const jumlahBagian = Math.ceil(teks.length / besar);
    const bagian = new Array(jumlahBagian);
    for (let i = 0, o = 0; i < jumlahBagian; ++i, o += besar) {
        bagian[i] = teks.substr(o, besar);
    }
    return bagian;
}

function log(kode, ...argumen2) {
    if (!creds.dev) return;
    return console.log(
        [
            `[TELEGRAM] [LOG] menginisialisasi bot`, // 0
            `[TELEGRAM] [LOG] menerima pesan`, // 1
            `[TELEGRAM] [LOG] mengirim pesan ke proses utama`, // 2
            `[TELEGRAM] [LOG] terhubung ke bot`, // 3
            `[TELEGRAM] [LOG] menerima pesan dari proses utama`, // 4
            `[TELEGRAM] [LOG] pesan terkirim`, // 5
            `[TELEGRAM] [ERROR] terjadi kesalahan saat mengirim pesan`, // 6
            `[TELEGRAM] [LOG] memulai ulang proses`, // 7
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
