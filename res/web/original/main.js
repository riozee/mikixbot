function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max + 1));
}

(function () {
    var bubbles = [[80], [20, 12], [20], [60, 18], [20], [110], [150], [25, 45], [15, 35], [150, 11]];
    for (var i = 0; i < 10; i++) {
        var delay = randomInt(0, 15) + 's';
        var css = {
            left: randomInt(0, 100) + '%',
            'animation-delay': delay,
            '-o-animation-delay': delay,
            '-moz-animation-delay': delay,
            '-webkit-animation-delay': delay,
        };
        var rand = randomInt(0, bubbles.length - 1);
        var bubble = bubbles[rand];
        bubbles.splice(rand, 1);
        css.width = bubble[0];
        css.height = bubble[0];
        var dur = bubble[1] ? bubble[1] + 's' : '25s';
        css['animation-duration'] = dur;
        css['-o-animation-duration'] = dur;
        css['-moz-animation-duration'] = dur;
        css['-webkit-animation-duration'] = dur;
        $('<div class="bubbles"></div>').css(css).appendTo('.bg-anim');
    }
})();

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
    if ((document.documentElement.className = tema) === 'tema-terang') {
        $('.button-tema').text('☀').css({
            'background-color': 'white',
        });
    } else {
        $('.button-tema').text('🌙').css({
            'background-color': 'black',
        });
    }
}

$('.button-tema').on('click', function () {
    if (document.documentElement.className === 'tema-terang') {
        aturTema('tema-gelap');
    } else {
        aturTema('tema-terang');
    }
});

(function () {
    var open = false;
    $('.menu').on('click', function () {
        function closes(e) {
            var klas = e.target.classList[0];
            if (klas === 'menu-dropdown' || klas === 'menu-svg' || klas === 'menu-svg-btn') {
                return;
            } else {
                $('.menu-svg').removeAttr('rx');
                $('.menu-svg').removeAttr('ry');
                $('.menu-dropdown').hide('fast');
                $(window).off('click', closes);
                open = false;
                return;
            }
        }
        if (open) {
            $('.menu-svg').removeAttr('rx');
            $('.menu-svg').removeAttr('ry');
            $('.menu-dropdown').hide('fast');
            $(window).off('click', closes);
            open = false;
        } else {
            $('.menu-svg').attr('rx', 10);
            $('.menu-svg').attr('ry', 10);
            $('.menu-dropdown').show('fast');
            open = true;
            $(window).on('click', closes);
        }
    });
})();
