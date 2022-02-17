const utils = require('../../utils');
const IPC = new utils.IPC('WA', process);
const fetch = require('node-fetch');
const fsp = require('fs/promises');
const fs = require('fs');
const _ = require('lodash');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

const cache = {
    msg: [],
    cekizin: {},
    namagrup: {},
    blocklist: [],
};

if (!fs.existsSync('./data/wa-tmpdb.json')) fs.writeFileSync('./data/wa-tmpdb.json', '{}');
cache.anch = JSON.parse(fs.readFileSync('./data/wa-tmpdb.json'));
setInterval(() => fs.writeFileSync('./data/wa-tmpdb.json', JSON.stringify(cache.anch)), 60000);

log(0);
const {
    default: makeWASocket,
    useSingleFileAuthState,
    DisconnectReason,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
} = require('@adiwajshing/baileys-md');
const pino = require('pino');

const { state, saveState } = useSingleFileAuthState('./data/' + creds.wasession);

function koneksikanKeWA() {
    return makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['Miki', 'Safari', '1.0.0'],
        version: [2, 2204, 13],
        auth: state,
    });
}

let receivedPendingNotifications = false;

log(8);
let bot = koneksikanKeWA();

function mulai() {
    if (!bot) {
        log(8);
        bot = koneksikanKeWA();
        cache.blocklist = [];
    }

    bot.ev.on('messages.upsert', async (_pesan) => {
        if (!receivedPendingNotifications) return;
        try {
            const pesan = _pesan.messages[0];
            if (!pesan.message) return;
            pesan.message = pesan.message.ephemeralMessage ? pesan.message.ephemeralMessage.message : pesan.message;
            if (_pesan.type !== 'notify') return;
            if (pesan.key?.fromMe) return;
            if (pesan.key?.remoteJid === 'status@broadcast') return;
            if (pesan.key?.id && cache.msg.find((v) => v.key.id === pesan.key?.id)) return;

            const uid = pesan.key?.participant || pesan.key?.remoteJid;
            const cid = pesan.key?.remoteJid;

            if (!(uid && cid)) return;

            if (!cache.cekizin[cid]) {
                if (cid.endsWith('@g.us')) {
                    try {
                        const { announce } = await bot.groupMetadata(cid);
                        if (announce) return (cache.cekizin[cid] = 'n');
                    } catch (e) {
                        if (String(e).includes('item-not-found')) return (cache.cekizin[cid] = 'n');
                        console.log(e);
                    }
                } else {
                    if (cache.blocklist.includes(cid)) return (cache.cekizin[cid] = 'n');
                }
                cache.cekizin[cid] = 'a';
            }
            if (cache.cekizin[cid] === 'n') return;

            log(1, pesan);

            let $pesan = {
                pengirim: uid === cid ? IDPengguna(uid) : IDChat(cid),
                uid: IDPengguna(uid),
                mid: pesan.key.id,
                name: pesan.pushName,
            };
            if (uid !== cid && !cache.namagrup[cid]) cache.namagrup[cid] = (await bot.groupMetadata(cid)).subject;
            $pesan.gname = cache.namagrup[cid];

            function muatPesan(tipe, isi) {
                const _ = {};

                const teks = (typeof isi === 'string' ? isi : '') || isi.caption || isi.text || isi.singleSelectReply?.selectedRowId || isi.selectedDisplayText || '';
                if (teks) _.teks = teks;

                if (isi.selectedButtonId) _.idRespon = isi.selectedButtonId;

                if (tipe === 'imageMessage') {
                    _.gambar = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|image`,
                        ukuran: Number(isi.fileLength),
                        eks: 'jpg',
                    };
                } else if (tipe === 'stickerMessage') {
                    _.stiker = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|sticker`,
                        ukuran: Number(isi.fileLength),
                        eks: 'webp',
                        animasi: isi.isAnimated,
                    };
                } else if (tipe === 'videoMessage') {
                    _.video = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|video`,
                        ukuran: Number(isi.fileLength),
                        durasi: isi.seconds * 1000,
                        eks: 'mp4',
                        gif: isi.gifPlayback,
                    };
                } else if (tipe === 'locationMessage' || tipe === 'liveLocationMessage') {
                    _.lokasi = {
                        lat: isi.degreesLatitude,
                        lon: isi.degreesLongitude,
                    };
                } else if (tipe === 'audioMessage') {
                    _.audio = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|audio`,
                        ukuran: Number(isi.fileLength),
                        durasi: isi.seconds * 1000,
                        eks: 'mp3',
                    };
                } else if (tipe === 'documentMessage') {
                    _.dokumen = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|document`,
                        ukuran: Number(isi.fileLength),
                        eks: isi.fileName.split('.').reverse()[0],
                        mimetype: isi.mimetype,
                        namaFile: isi.fileName,
                    };
                } else if (tipe === 'contactMessage') {
                    _.kontak = [
                        {
                            nama: isi.displayName,
                            nomor: isi.vcard.match(/TEL.*:([\+\(\)\-\. \d]+)/)?.[1],
                        },
                    ];
                } else if (tipe === 'contactsArrayMessage') {
                    _.kontak = [];
                    isi.contacts.forEach((kontak) => {
                        _.kontak.push({
                            nama: kontak.displayName,
                            nomor: kontak.vcard.match(/TEL.*:([\+\(\)\-\. \d]+)/)?.[1],
                        });
                    });
                } else if (tipe === 'productMessage') {
                    if (isi.product?.productImage) {
                        _.gambar = {
                            id: `${isi.product.productImage.mediaKey.toString()}|${isi.product.productImage.directPath}|${isi.product.productImage.url}|image`,
                            ukuran: Number(isi.product.productImage.fileLength),
                            eks: 'jpg',
                        };
                        _.teks = `${isi.product.title || ''}\n${isi.product.description || ''}\nhttps://wa.me/p/${isi.product.productId || ''}/${
                            isi.businessOwnerJid?.replace?.('@s.whatsapp.net', '') || ''
                        }`;
                        _.wa_product_message = true;
                    } else {
                        _.teks = `${isi.product?.title || ''}\n${isi.product?.description || ''}\nhttps://wa.me/p/${isi.product?.productId || ''}/${
                            isi.businessOwnerJid?.replace?.('@s.whatsapp.net', '') || ''
                        }`;
                        _.wa_product_message = true;
                    }
                } else if (tipe === 'viewOnceMessage') {
                    tipe = Object.keys(isi.message)[0];
                    isi = isi.message[tipe];
                    if (tipe === 'imageMessage') {
                        _.gambar = {
                            id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|image`,
                            ukuran: Number(isi.fileLength),
                            eks: 'jpg',
                            wa_view_once: true,
                        };
                    } else if (tipe === 'videoMessage') {
                        _.video = {
                            id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|video`,
                            ukuran: Number(isi.fileLength),
                            durasi: isi.seconds * 1000,
                            eks: 'mp4',
                            wa_view_once: true,
                        };
                    }
                }

                return _;
            }

            for (const tipe in pesan.message) {
                if (tipe === 'senderKeyDistributionMessage') continue;
                if (tipe === 'messageContextInfo') continue;
                if (tipe === 'protocolMessage') continue;

                const isi = pesan.message[tipe];
                $pesan = {
                    ...$pesan,
                    ...muatPesan(tipe, isi),
                    mentioned: [],
                };
                if (isi.contextInfo?.expiration) $pesan.wa_disappearing_message = isi.contextInfo.expiration;
                if (isi.contextInfo?.mentionedJid) $pesan.mentioned.push(...isi.contextInfo.mentionedJid.map((v) => IDPengguna(v)));
                if (isi.contextInfo?.participant) $pesan.mentioned.push(IDPengguna(isi.contextInfo.participant));
                if (isi.contextInfo?.quotedMessage) {
                    for (const tipe in isi.contextInfo.quotedMessage) {
                        const _isi = isi.contextInfo.quotedMessage[tipe];
                        $pesan.q = muatPesan(tipe, _isi);
                        $pesan.q.mid = isi.contextInfo.stanzaId;
                        $pesan.q.me = isi.contextInfo.participant === creds.bot_wa_id;
                        break;
                    }
                }

                break;
            }

            log(2, $pesan);
            cache.msg.push(pesan);
            setTimeout(
                (id) => {
                    cache.msg.splice(
                        cache.msg.findIndex((_pesan) => _pesan.key.id === id),
                        1
                    );
                },
                60000 * 5,
                `${pesan.key.id}`
            );
            IPC.kirimSinyal('PR', $pesan);
        } catch (eror) {
            log(7);
            console.error(eror);
        }
    });

    bot.ev.on('connection.update', async (pembaruan) => {
        if (pembaruan.receivedPendingNotifications) receivedPendingNotifications = true;
        const { connection, lastDisconnect } = pembaruan;
        if (connection === 'close') {
            receivedPendingNotifications = false;
            log(9, lastDisconnect);
            bot = null;
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                return mulai();
            } else {
                return;
            }
        }
        if (connection && connection !== 'connecting') {
            bot.fetchBlocklist().then((v) => v.forEach((v) => cache.blocklist.push(v)));
            log(3, pembaruan);
        }
    });

    bot.ev.on('creds.update', saveState);

    bot.ev.on('groups.update', (upd) => {
        upd.forEach((u) => {
            if (u.announce) {
                cache.cekizin[u.id] = 'n';
            } else if (u.subject) {
                cache.namagrup[u.id] = u.subject;
            }
        });
    });
    bot.ev.on('groups.upsert', (upd) => {
        upd.forEach((u) => (u.announce ? (cache.cekizin[u.id] = 'n') : 0));
    });
    bot.ev.on('group-participants.update', (upd) => {
        if (upd.participants.includes(creds.bot_wa_id)) {
            if (upd.action === 'remove') cache.cekizin[upd.id] = 'n';
        } else {
            if (upd.action === 'add') {
                IPC.kirimSinyal('PR', {
                    pengirim: IDChat(upd.id),
                    gname: cache.namagrup[upd.id],
                    welcome: upd.participants.map((v) => '@' + v.split('@')[0]),
                });
            }
            if (upd.action === 'remove') {
                IPC.kirimSinyal('PR', {
                    pengirim: IDChat(upd.id),
                    gname: cache.namagrup[upd.id],
                    leave: upd.participants.map((v) => '@' + v.split('@')[0]),
                });
            }
        }
    });
    bot.ev.on('blocklist.set', async () => {
        cache.blocklist = await bot.fetchBlocklist();
    });
    bot.ev.on('blocklist.update', async () => {
        cache.blocklist = await bot.fetchBlocklist();
    });
}

mulai();

async function kirimPesan(pesan) {
    log(4, pesan);
    const $ = pesan._;
    const penerima = ID($.penerima);
    if (cache.cekizin[penerima] === 'n') return { s: false, _e: 'notallowed' };
    if (!cache.cekizin[penerima]) {
        if (penerima.endsWith('@g.us')) {
            try {
                const { announce } = await bot.groupMetadata(penerima);
                if (announce) {
                    cache.cekizin[penerima] = 'n';
                    return { s: false, _e: 'notallowed' };
                }
            } catch (e) {
                if (String(e).includes('item-not-found')) {
                    cache.cekizin[penerima] = 'n';
                    return { s: false, _e: 'notallowed' };
                }
                console.log(e);
            }
        } else {
            if (cache.blocklist.includes(penerima)) {
                cache.cekizin[penerima] = 'n';
                return { s: false, _e: 'notallowed' };
            }
        }
        cache.cekizin[penerima] = 'a';
    }
    let opsi = {};
    if ($.hasOwnProperty('re')) {
        if (typeof $.re === 'string' && $.anch) {
            if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
            opsi.quoted = cache.anch[$.anch.roomID][$.re];
        } else {
            opsi.quoted = cache.msg.filter((_pesan) => _pesan.key.id == $.mid)[0];
        }
    }
    if ($.wa_disappearing_message) opsi.ephemeralExpiration = $.wa_disappearing_message;

    try {
        const msg = {};
        let omsg;

        //////////////////////////////// GAMBAR
        if ($.gambar) {
            if ($.gambar.id) msg.image = { url: await unduhMedia($.gambar) };
            else if ($.gambar.file || $.gambar.url) msg.image = { url: $.gambar.file || $.gambar.url };
            msg.caption = $.teks;
            if ($.gambar.wa_view_once) msg.viewOnce = true;
        }

        //////////////////////////////// STIKER
        else if ($.stiker) {
            if ($.stiker.id) msg.sticker = { url: await unduhMedia($.stiker) };
            else if ($.stiker.file || $.stiker.url) msg.sticker = { url: $.stiker.file || $.stiker.url };
        }

        //////////////////////////////// VIDEO
        else if ($.video) {
            if ($.video.id) msg.video = { url: await unduhMedia($.video) };
            else if ($.video.file || $.video.url) msg.video = { url: $.video.file || $.video.url };
            msg.caption = $.teks;
            if ($.video.wa_view_once) msg.viewOnce = true;
            if ($.video.gif) msg.gifPlayback = true;
        }

        //////////////////////////////// LOKASI
        else if ($.lokasi) {
            msg.location = { degreesLatitude: $.lokasi.lat, degreesLongitude: $.lokasi.lon };
        }

        //////////////////////////////// AUDIO
        else if ($.audio) {
            if ($.teks) {
                if ($.audio.id) omsg = await bot.sendMessage(penerima, { audio: { url: await unduhMedia($.audio) } }, opsi);
                else if ($.audio.file || $.audio.url)
                    omsg = await bot.sendMessage(penerima, { audio: { url: $.audio.file || $.audio.url }, mimetype: 'audio/mpeg' }, opsi);
                msg.text = $.teks;
            } else {
                if ($.audio.id) msg.audio = { url: await unduhMedia($.audio) };
                else if ($.audio.file || $.audio.url) msg.audio = { url: $.audio.file || $.audio.url };
                msg.mimetype = 'audio/mpeg';
            }
        }

        //////////////////////////////// DOKUMEN
        else if ($.dokumen) {
            if ($.teks) {
                if ($.dokumen.id)
                    omsg = await bot.sendMessage(
                        penerima,
                        { document: { url: await unduhMedia($.dokumen) }, mimetype: $.dokumen.mimetype, fileName: $.dokumen.namaFile },
                        opsi
                    );
                else if ($.dokumen.file || $.dokumen.url)
                    omsg = await bot.sendMessage(
                        penerima,
                        { document: { url: $.dokumen.file || $.dokumen.url }, mimetype: $.dokumen.mimetype, fileName: $.dokumen.namaFile },
                        opsi
                    );
                msg.text = $.teks;
            } else {
                if ($.dokumen.id) {
                    msg.document = { url: await unduhMedia($.dokumen) };
                    msg.mimetype = $.dokumen.mimetype;
                    msg.fileName = $.dokumen.namaFile;
                } else if ($.dokumen.file || $.dokumen.url) {
                    msg.document = { url: $.dokumen.file || $.dokumen.url };
                    msg.mimetype = $.dokumen.mimetype;
                    msg.fileName = $.dokumen.namaFile;
                }
            }
        }

        //////////////////////////////// KONTAK
        else if ($.kontak) {
            const kontak = [];
            for await (const kntk of $.kontak) {
                const diWA = (await bot.onWhatsApp(kntk.nomor?.replace?.(/\D+/g, '')))?.[0]?.exists;
                kontak.push({
                    displayName: kntk.nama,
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${kntk.nama}\nTEL${diWA ? `;waid=${kntk.nomor?.replace?.(/\D+/g, '')}` : ''}:${
                        kntk.nomor || '000000000000'
                    }\nEND:VCARD`,
                });
            }
            msg.contacts = { contacts: kontak };
        }

        //////////////////////////////// FORWARD MESSAGE
        else if ($.copy) {
            if ($.copy.q) {
                const p = cache.msg.filter((v) => v.key.id === $.copy.q)[0].message;
                if (!p) throw 'nomsg';
                let q, _tipe;
                for (const tipe in p) {
                    if (tipe === 'senderKeyDistributionMessage') continue;
                    if (tipe === 'messageContextInfo') continue;
                    if (tipe === 'protocolMessage') continue;
                    for (const qtipe in p[tipe].contextInfo.quotedMessage) {
                        q = p[tipe].contextInfo.quotedMessage[qtipe];
                        _tipe = qtipe;
                        break;
                    }
                    break;
                }
                const fmsg = generateForwardMessageContent({ key: {}, message: { [_tipe]: q } });
                const cmsg = generateWAMessageFromContent(penerima, fmsg, opsi);
                await bot.relayMessage(penerima, cmsg.message, { messageId: cmsg.key.id });
                return { s: true, mid: cmsg.key.id };
            }

            const _msg = cache.anch[$.copy.roomID][$.copy.msgID];
            const fmsg = generateForwardMessageContent(_msg);
            for (const tipe in fmsg) {
                if (tipe === 'senderKeyDistributionMessage') continue;
                if (tipe === 'messageContextInfo') continue;
                if (tipe === 'protocolMessage') continue;
                fmsg[tipe].contextInfo = {};
                break;
            }
            const cmsg = generateWAMessageFromContent(penerima, fmsg, opsi);
            await bot.relayMessage(penerima, cmsg.message, { messageId: cmsg.key.id });
            if ($.anch) {
                if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
                cache.anch[$.anch.roomID][cmsg.key.id] = cmsg;
            }
            log(5);
            return { s: true, mid: cmsg.key.id };
        }

        //////////////////////////////// TEKS
        else {
            msg.text = $.teks;
        }
        if ($.saran && ($.teks || $.gambar || $.video || $.dokumen || $.lokasi)) {
            msg.buttons = $.saran.map((v) => ({
                buttonId: Math.random().toString(36).slice(2),
                buttonText: { displayText: v },
                type: 1,
            }));
        }
        if ($.teks && /@\d+/g.test($.teks)) {
            const matches = $.teks.match(
                /@(?:999|998|997|996|995|994|993|992|991|990|979|978|977|976|975|974|973|972|971|970|969|968|967|966|965|964|963|962|961|960|899|898|897|896|895|894|893|892|891|890|889|888|887|886|885|884|883|882|881|880|879|878|877|876|875|874|873|872|871|870|859|858|857|856|855|854|853|852|851|850|839|838|837|836|835|834|833|832|831|830|809|808|807|806|805|804|803|802|801|800|699|698|697|696|695|694|693|692|691|690|689|688|687|686|685|684|683|682|681|680|679|678|677|676|675|674|673|672|671|670|599|598|597|596|595|594|593|592|591|590|509|508|507|506|505|504|503|502|501|500|429|428|427|426|425|424|423|422|421|420|389|388|387|386|385|384|383|382|381|380|379|378|377|376|375|374|373|372|371|370|359|358|357|356|355|354|353|352|351|350|299|298|297|296|295|294|293|292|291|290|289|288|287|286|285|284|283|282|281|280|269|268|267|266|265|264|263|262|261|260|259|258|257|256|255|254|253|252|251|250|249|248|247|246|245|244|243|242|241|240|239|238|237|236|235|234|233|232|231|230|229|228|227|226|225|224|223|222|221|220|219|218|217|216|215|214|213|212|211|210|98|95|94|93|92|91|90|86|84|82|81|66|65|64|63|62|61|60|58|57|56|55|54|53|52|51|49|48|47|46|45|44|43|41|40|39|36|34|33|32|31|30|27|20|7|1)[0-9]{3,14}/g
            );
            if (matches) {
                const mentioned = [];
                for (const match of matches) {
                    mentioned.push(match.slice(1) + '@s.whatsapp.net');
                }
                msg.mentions = _.uniq(mentioned);
            }
        }

        const terkirim = await bot.sendMessage(penerima, msg, opsi);
        if ($.anch) {
            if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
            cache.anch[$.anch.roomID][terkirim.key.id] = terkirim;
            if (omsg?.key?.id) cache.anch[$.anch.roomID][omsg.key.id] = omsg;
        }
        log(5);
        return { s: true, mid: [omsg?.key?.id, terkirim.key.id].filter(Boolean) };
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false, _e: e };
    }
}

async function unduhMedia(media) {
    let [mediaKey, directPath, url, type] = media.id.split('|');
    let ext = media.eks;
    mediaKey = Uint8Array.from(mediaKey.split(','));
    const stream = await downloadContentFromMessage({ mediaKey, directPath, url }, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.${ext}`;
    await fsp.writeFile(keluaran, buffer);
    return keluaran;
}

function anch(pesan) {
    if (pesan._.anch.roomID) {
        const roomID = pesan._.anch.roomID,
            msgID = pesan._.anch.msgID;
        if (!cache.anch) cache.anch = {};
        const msg = cache.msg.filter((_pesan) => _pesan.key.id == msgID)[0];
        if (!cache.anch[roomID]) cache.anch[roomID] = {};
        cache.anch[roomID][msgID] = msg;
    } else if (pesan._.anch.delRoomID) {
        const roomID = pesan._.anch.delRoomID;
        if (cache.anch) delete cache.anch[roomID];
    }
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
                    admin: Boolean((await bot.groupMetadata(ID(pesan._.isAdmin.c))).participants.filter((v) => v.id === ID(pesan._.isAdmin.u))[0]?.admin),
                };
            } else if (pesan._?.delmsg) {
                return { r: Boolean(await bot.sendMessage(ID(pesan._.delmsg.cid), { delete: { id: pesan._.delmsg.mid } })) };
            } else if (pesan._?.isOwner) {
                return {
                    owner: await (async () => {
                        const id = ID(pesan._.isOwner.c);
                        const uid = ID(pesan._.isOwner.u);
                        const gdata = await bot.groupMetadata(id);
                        if (gdata.owner === uid) return true;
                        if (gdata.participants.find((v) => v.id === uid)?.admin === 'superadmin') return true;
                        return false;
                    })(),
                };
            } else if (pesan._?.descGroup) {
                return {
                    desc: (await bot.groupMetadata(ID(pesan._.descGroup))).desc.toString(),
                };
            } else if (pesan._?.wa_participants) {
                return {
                    members: (await bot.groupMetadata(ID(pesan._.wa_participants))).participants.map((v) => IDPengguna(v.id)),
                };
            }
        });
    } else {
        IPC.terimaSinyal(pesan, async (pesan) => {
            if (pesan._?.penerima) {
                return await kirimPesan(pesan);
            } else if (pesan._?.anch) {
                return anch(pesan);
            }
        });
    }
});

process.on('exit', () => fs.writeFileSync('./data/wa-tmpdb.json', JSON.stringify(cache.anch)));

function IDChat(ID) {
    return 'WA#' + ID.replace('@g.us', '') + '#C';
}

function IDPengguna(ID) {
    return 'WA#' + ID.replace('@s.whatsapp.net', '');
}

function ID(_ID) {
    if (_ID.endsWith('#C')) {
        return _ID.replace('WA#', '').replace('#C', '') + '@g.us';
    } else {
        return _ID.replace('WA#', '') + '@s.whatsapp.net';
    }
}

function log(kode, ...argumen2) {
    if (!creds.dev) return;
    return console.log(
        [
            `[WHATSAPP] [LOG] menginisialisasi bot`, // 0
            `[WHATSAPP] [LOG] menerima pesan`, // 1
            `[WHATSAPP] [LOG] mengirim pesan ke proses utama`, // 2
            `[WHATSAPP] [LOG] terhubung ke bot`, // 3
            `[WHATSAPP] [LOG] menerima pesan dari proses utama`, // 4
            `[WHATSAPP] [LOG] pesan terkirim`, // 5
            `[WHATSAPP] [ERROR] terjadi kesalahan saat mengirim pesan`, // 6
            `[WHATSAPP] [ERROR] terjadi kesalahan saat menerima pesan`, // 7
            `[WHATSAPP] [LOG] menghubungkan ke bot`, // 8
            `[WHATSAPP] [ERROR] koneksi terputus dari bot`, // 9
            `[WHATSAPP] [LOG] memulai ulang proses`, // 10
        ][kode],
        ...argumen2
    );
}

if (creds.watch) {
    fs.watch(__filename, () => {
        log(10);
        process.exit();
    });
}
