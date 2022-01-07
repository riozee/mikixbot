//////////////////// FUNCTIONS

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max + 1));
}

//////////////////// TEMA GELAP/TERANG

(function () {
    var tema = localStorage.getItem('tema');
    if (tema) {
        aturTema(tema);
    } else {
        aturTema('tema-terang');
    }
})();

function aturTema(tema) {
    localStorage.setItem('tema', tema);
    document.documentElement.className = tema;
    if (tema === 'tema-gelap') {
        var kontak = document.getElementById('ganti-tema');
        kontak.checked = true;
    }
}

function gantiTema() {
    var kontak = document.getElementById('ganti-tema');
    if (kontak.checked) {
        aturTema('tema-gelap');
    } else {
        aturTema('tema-terang');
    }
}

//////////////////// ANIMASI LATAR BELAKANG

(function () {
    var bubbles = [[80], [20, 12], [20], [60, 18], [20], [110], [150], [25, 45], [15, 35], [150, 11]];
    for (var i = 0; i < 10; i++) {
        var css = {
            position: 'absolute',
            display: 'block',
            left: randomInt(0, 100) + '%',
            background: 'rgba(var(--bg-bubbles-color), 1)',
            'animation-name': 'bg-anim',
            'animation-direction': 'linear',
            'animation-iteration-count': 'infinite',
            'animation-delay': randomInt(0, 15) + 's',
            bottom: '-150px',
        };
        var rand = randomInt(0, bubbles.length - 1);
        var bubble = bubbles[rand];
        bubbles.splice(rand, 1);
        css.width = bubble[0];
        css.height = bubble[0];
        if (bubble[1]) css['animation-duration'] = bubble[1] + 's';
        else css['animation-duration'] = '25s';
        $('<div></div>').css(css).appendTo('#bg-anim');
    }
})();
