
const site_url = "https://i.imgur.com/";
const MAX = 100;
const links = [];

const container = document.getElementById("imgur-images");
const reload = document.getElementById("reload");
const setnumber = document.getElementById("setnumber");

let fragment = new DocumentFragment();

function get_link() {
    const smallchars = "abcdefgihjklmnopqrstuvwxyz";
    const bigchars = smallchars.toUpperCase();
    const numbers = "1234567890";
    let characters = smallchars + bigchars + smallchars + bigchars + numbers;
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += characters[Math.round((characters.length - 1) * Math.random())];
    }
    return site_url + code + ".jpg";
}

function start() {
    repeat(load_image, Math.min(MAX, setnumber.value));
    container.appendChild(fragment);
} start();

reload.addEventListener('click', () => {
    container.textContent = '';
    start();
});

function repeat(fn, times = 1) {
    for (let i = 0; i < times; i++) {
        setTimeout(fn(), 50);
    }
}

function load_image() {
    const link = get_link();
    // Check for duplicates but can't avoid same images with different names.
    if (!links.some(onelink => onelink.includes(link))) {
        fetch(link)
            .then((res) => {
                if (res.ok) {
                    return res.blob()
                }
                return console.log(Promise.reject(res));
            })
            .then(blob => {
                const newImg = new Image();
                newImg.src = URL.createObjectURL(blob);
                newImg.className = "imgur-image";
                newImg.setAttribute("data-link", link);
                newImg.onload = () => {
                    if (newImg.naturalWidth === 161 && newImg.naturalHeight) {
                        load_image();
                        return;
                    }
                    fragment.appendChild(newImg);
                    container.appendChild(fragment);
                }
                newImg.onclick = () => {
                    let url = newImg.getAttribute('data-link');
                    window.open(url, '_blank').focus();
                }
            })
            .catch((error) => {
                console.log('Something went wrong.', error);
            });
        links.push(link);
    }
}