const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;
const root = path.resolve('./res/web');

app.use(express.static(root));
app.use(express.json());

app.listen(port, () => {
    console.log(`Example app listening at ${port}`);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(root, 'main.html'));
});
