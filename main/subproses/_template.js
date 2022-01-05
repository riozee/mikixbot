const utils = require('../utils');
const IPC = new utils.IPC('TP', process);

const argv = JSON.parse(process.argv[2]);

async function proses(pesan) {}

async function prosesKueri(pesan) {}

process.on('message', (pesan) => {
    if ($ /* sinyal */) {
        IPC.terimaSinyal(pesan, (pesan) => proses(pesan));
    }
    if ($ /* kueri */) {
        IPC.terimaDanBalasKueri(pesan, (pesan) => prosesKueri(pesan));
    }
});

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[TEMPLATE] ini hanyalah template untuk membuat file subproses baru.`, // 0
        ][kode],
        ...argumen2
    );
}
