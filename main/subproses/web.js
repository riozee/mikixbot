const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const root = path.resolve('./res/web');

app.use(express.static(root));
app.use(express.json());

app.set('views', path.resolve('./res/web/pages/'));
app.set('view engine', 'ejs');

app.listen(port, () => {
    console.log(`[WEB] Listening at port ${port}`);
});

app.get('/', (req, res) => {
    res.render('home');
});

app.get('/commands', (req, res) => {
    res.render('commands');
});
