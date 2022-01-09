const utils = require('../utils');
const IPC = new utils.IPC('WEB', process);
const express = require('express');
const path = require('path');

const argv = JSON.parse(process.argv[2]);

log(0);
const app = express();
const port = process.env.PORT || 3000;
const root = path.resolve('./res/web');

app.use(express.static(root));
app.use(express.json());

app.set('views', path.resolve('./res/web/pages/'));
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    log(2, '/');
    res.render('home');
});

app.get('/commands', (req, res) => {
    log(2, '/commands');
    res.render('commands');
});

app.listen(port, () => {
    log(1, port);
});

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[WEB] [LOG] menginisialisasi`, // 0
            `[WEB] [LOG] mendengarkan port:`, // 1
            `[WEB] [LOG] mendapat GET request ke`, // 2
        ][kode],
        ...argumen2
    );
}
