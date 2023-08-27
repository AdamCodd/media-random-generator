const site_url = "https://i.imgur.com/";
const MAX = 100;
const links = new Set();  // Changed to Set for O(1) lookups

const container = document.getElementById("imgur-images");
const reload = document.getElementById("reload");
const setnumber = document.getElementById("setnumber");

const fragment = document.createDocumentFragment();  // Use `const` as it doesn't change

const chars = "abcdefgihjklmnopqrstuvwxyz";
const characters = chars + chars.toUpperCase() + "1234567890";  // Pre-compute character set

function get_link() {
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }
    return `${site_url}${code}.jpg`;
}

function start() {
    const numImages = Math.min(MAX, Number(setnumber.value));
    for (let i = 0; i < numImages; i++) {
        load_image();
    }
    container.appendChild(fragment);
}
start();

reload.addEventListener('click', () => {
    container.textContent = '';
    start();
});

function load_image() {
    const link = get_link();
    if (!links.has(link)) {  // O(1) lookup
        fetch(link)
            .then(res => res.ok ? res.blob() : Promise.reject(res))
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
                newImg.onclick = () => window.open(link, '_blank').focus();
            })
            .catch(error => console.log('Something went wrong.', error));
        links.add(link);  // O(1) insertion
    }
}
