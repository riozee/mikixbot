const utils = require('../utils');
const IPC = new utils.IPC('RS', process);
const FeedParser = require('feedparser');
const fetch = require('node-fetch');
const fs = require('fs');
const _ = require('lodash');
const { htmlToText } = require('html-to-text');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

let cache = {
    lastpub: {},
    retries: {},
};

if (!fs.existsSync('./data/rss-tmpdb.json')) fs.writeFileSync('./data/rss-tmpdb.json', JSON.stringify(cache));
else cache = JSON.parse(fs.readFileSync('./data/rss-tmpdb.json'));
setInterval(() => fs.writeFileSync('./data/rss-tmpdb.json', JSON.stringify(cache)), 30000);

let RSS = [];
(async () => {
    let { _e, hasil } = await IPC.kirimKueri('DB', {
        r: { rss: { $exists: true } },
        m: true,
    });
    if (_e) throw 'dberror';
    RSS = hasil.map((v) => ({ chat: v._id, rss: v.rss }));
})()
    .then(() => {})
    .catch(() => process.exit());

async function tambahRSS(link, chat) {
    try {
        await cekRSS(link);
    } catch (e) {
        if (String(e) == 'Error: Not a feed') return { _e: 'notfeed' };
        else return { _e: e };
    }
    const { _e } = IPC.kirimKueri('DB', {
        u: [{ _id: chat }, { $push: { rss: link } }],
    });
    if (_e) return { _e: _e };
    RSS.push({ chat: chat, rss: link });
    return { h: true };
}

async function hapusRSSdenganIndex(index, chat) {
    const link = RSS[RSS.findIndex((v) => v.chat === chat)].rss[index];
    if (!link) return { _e: 'outofindex' };
    const { _e } = IPC.kirimKueri('DB', {
        u: [{ _id: chat }, { $pull: { rss: link } }],
    });
    if (_e) return { _e: _e };
    _.pull(RSS[RSS.findIndex((v) => v.chat === chat)].rss, link);
    delete cache.lastpub[link];
    delete cache.retries[link];
    return { h: true, l: link };
}

async function hapusRSS(link, chat) {
    const rssInChat = RSS[RSS.findIndex((v) => v.chat === chat)];
    const { _e } =
        rssInChat.rss.length === 1
            ? IPC.kirimKueri('DB', {
                  u: [{ _id: chat }, { $unset: { rss: 1 } }],
              })
            : IPC.kirimKueri('DB', {
                  u: [{ _id: chat }, { $pull: { rss: link } }],
              });
    if (_e) return { _e: _e };
    if (rssInChat.rss.length === 1) _.remove(RSS, rssInChat);
    else _.pull(rssInChat.rss, link);
    delete cache.lastpub[link];
    delete cache.retries[link];
    return { h: true };
}

async function cekRSS(link) {
    const feedparser = new FeedParser();
    const req = fetch(link, {
        method: 'GET',
        headers: {
            'If-Modified-Since': cache.lastpub[link]?.['Last-Modified'],
        },
    });
    return await new Promise((resolve, reject) => {
        req.then((res) => {
            cache.lastpub[link] ||= {};
            if (res.status != 200) {
                if (res.status == 304) return resolve('notmodified-304');
                const err = new Error('Bad status code: ' + res.status);
                console.error(err);
                return reject(err);
            }
            if (res.headers.get('Last-Modified')) cache.lastpub[link]['Last-Modified'] = res.headers.get('Last-Modified');
            res.body.pipe(feedparser);
        }).catch((v) => {
            console.error(v);
            reject(v);
        });
        feedparser.on('error', (e) => {
            console.error(e);
            reject(e);
        });
        let items = [];
        feedparser.on('readable', function () {
            const stream = this;
            let item;
            while ((item = stream.read())) {
                items.push(item);
            }
        });
        feedparser.on('end', function () {
            if ((this.meta.pubdate || this.meta.pubDate) && cache.lastpub[link]?.['pubDate'] == (this.meta.pubdate || this.meta.pubDate))
                return resolve('notmodified-samepubdate');
            cache.lastpub[link]['pubDate'] = this.meta.pubdate || this.meta.pubDate;
            if (items[0]?.pubDate || items[0]?.pubdate) {
                items = items.sort((a, b) => new Date(a.pubdate || a.pubDate).getTime() - new Date(b.pubdate || b.pubDate).getTime());
                for (const item of items) {
                    if (cache.lastpub[link]?.['itemPubDate']) {
                        const cdate = new Date(cache.lastpub[link]['itemPubDate']);
                        const idate = new Date(item.pubDate || item.pubdate);
                        if (cdate.getTime() >= idate.getTime()) {
                            _.remove(items, (v) => v.pubDate || v.pubdate === item.pubDate || item.pubdate);
                            continue;
                        }
                    }
                    cache.lastpub[link]['itemPubDate'] = item.pubDate || item.pubdate;
                }
            }
            if (items.length > 0) {
                resolve({
                    items: items.map((v) => ({
                        title: v.title,
                        link: v.guid || v.link,
                        desc: v.summary || v.description ? htmlToText(v.summary || v.description) : undefined,
                        image: v.image?.url || v.image?.href || v.enclosures?.filter?.((v) => ['image/jpeg', 'image/png'].includes(v.type))?.[0]?.url,
                    })),
                });
            } else {
                resolve('notmodified-noitems');
            }
        });
    });
}

process.on('message', (pesan) => {
    IPC.terimaDanBalasKueri(pesan, async (pesan) => {
        if (pesan._?.add) {
            return await tambahRSS(pesan._.add[0], pesan._.add[1]);
        } else if (pesan._?.del) {
            return await hapusRSSdenganIndex(pesan._.del[0], pesan._.del[1]);
        }
    });
});

setInterval(async () => {
    for (const { rss, chat } of RSS) {
        for (const link of rss) {
            try {
                const res = await cekRSS(link);
                console.log('rss', 3, link, res);
                if (res.startsWith?.('notmodified')) continue;
                IPC.kirimSinyal('PR', {
                    rss: {
                        c: chat,
                        items: res.items,
                    },
                });
                delete cache.retries[link];
            } catch (e) {
                cache.retries[link] ||= 0;
                cache.retries[link]++;
                if (cache.retries[link] > 1440) {
                    await hapusRSS(link, chat);
                    IPC.kirimSinyal('PR', {
                        rss: {
                            c: chat,
                            fail: {
                                link: link,
                                reason: String(e),
                            },
                        },
                    });
                }
            }
        }
    }
}, 60000);

if (creds.watch) {
    require('fs').watch(__filename, () => {
        process.exit();
    });
}
