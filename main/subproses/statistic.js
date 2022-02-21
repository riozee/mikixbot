const utils = require('../utils');
const IPC = new utils.IPC('ST', process);

const fs = require('fs');
const fsp = require('fs/promises');
const fetch = require('node-fetch');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

if (!fs.existsSync('./data/stats.json')) fs.writeFileSync('./data/stats.json', '{}');
const data = JSON.parse(fs.readFileSync('./data/stats.json').toString() || '{}');

setInterval(async () => {
    data.t ||= Date.now();
    await fsp.writeFile('./data/stats.json', JSON.stringify(data));
    if (Date.now() - data.t > 3_600_000) {
        data.t = Date.now();
        const commands = [],
            media = [];

        for (const command in data.c) {
            for (const cmdtimestamp of data.c[command]) {
                if (Date.now() - cmdtimestamp > 2_678_400_000) break;
                commands.unshift(cmdtimestamp);
            }
        }
        for (const [ratio, step] of [
            [1, 60],
            [6, 60],
            [24, 60],
            [24 * 7, 60],
            [24 * 31, 60],
        ]) {
            const datapoints = [];
            let lastindex = 0;
            const interval = (3_600_000 * ratio) / step;
            for (let i = 0; i < step; i++) {
                const intervaltop = data.t - interval * i;
                const intervalbottom = data.t - interval * (i + 1);
                const _data = [];
                for (const timestamp of commands.slice(lastindex)) {
                    if (timestamp < intervaltop && timestamp > intervalbottom) {
                        _data.unshift(timestamp);
                    } else break;
                    lastindex++;
                }
                datapoints.unshift(_data);
            }
            try {
                media.push({
                    file: await getChart(
                        datapoints.map((v) => v.length).join(','),
                        Array.from({ length: step }, (v, i) => {
                            if (i % 3 !== 0) return '';
                            const date = new Date(data.t - ((3_600_000 * ratio) / step) * (step - i + 1));
                            return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} ${String(date.getUTCDate()).padStart(
                                2,
                                '0'
                            )}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
                        }).join('|'),
                        `Miki Bot commands count in the last ${ratio} hours`
                    ),
                });
            } catch (e) {
                console.error(e);
                continue;
            }
        }
        IPC.kirimSinyal('TG', {
            penerima: creds.tg_stats_channel_id,
            dokumen: { file: './data/stats.json' },
        });
        IPC.kirimSinyal('TG', {
            penerima: creds.tg_stats_channel_id,
            gambar: media,
        });
    }
}, 15000);

async function getChart(chd_chartData, label_chartLabel, chtt_chartTitle) {
    const link = `https://image-charts.com/chart?chd=${encodeURI('t:' + chd_chartData)}&chs=700x450&cht=lc&chtt=${encodeURI(chtt_chartTitle)}&chxl=${encodeURI(
        '0:|' + label_chartLabel
    )}&chxt=x%2Cy&chma=10%2C10%2C20%2C10&bkg=EEEEEE&chco=40C81E&chg=1%2C1%2C1%2C3&chxs=0%2Cmin90&chls=2`;
    const res = await fetch(link);
    if (res.headers.get('content-type') != 'image/png') throw 'not an image';
    const file = './tmp/' + utils.namaFileAcak() + '.png';
    await fsp.writeFile(file, await res.buffer());
    return file;
}

process.on('message', (pesan) => {
    IPC.terimaSinyal(pesan, (pesan) => {
        const $ = pesan._;
        if ($?.c) {
            data.c ||= {};
            data.c[$.c[1]] ||= [];
            data.c[$.c[1]].unshift($.c[0]);
        }
    });
});

if (creds.watch) {
    require('fs').watch(__filename, () => {
        process.exit();
    });
}
