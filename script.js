// Constants
const MAX = 100;
const STREAMABLE_LIMIT = 5;
const links = new Set();  // Cache

// HTML Elements
const container = document.getElementById("media-container");
const reload = document.getElementById("reload");
const setnumber = document.getElementById("setnumber");
const serviceSelector = document.getElementById("serviceSelector");

// Counter for Streamable links
let streamableCount = 0;  // New counter

// Precompute Character Sets
const allChars = "abcdefgihjklmnopqrstuvwxyz";
const allCharsUpper = allChars.toUpperCase();
const allNumbers = "1234567890";
const characters = allChars + allCharsUpper + allNumbers;

function getImgurLink() {
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }
    return `https://i.imgur.com/${code}.jpg`;
}


function getStreamableLink() {
    let alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `https://streamable.com/${code}`;
}

function getLink() {
    const service = serviceSelector.value;
    if (service === "imgur") {
        return getImgurLink();
    } else if (service === "streamable") {
        return getStreamableLink();
    }
}

function load_streamable() {
    if (streamableCount >= STREAMABLE_LIMIT) {  // Check the limit
        return;
    }
  
    let randomCode = getStreamableLink().split("com/")[1];
    let randomUrl = `https://api.streamable.com/oembed.json?url=https://streamable.com/${randomCode}`;
    
    $.getJSON(randomUrl)
    .done(function(data) {
        let iframe = document.createElement("iframe");
        iframe.src = `https://streamable.com/${randomCode}`;
        iframe.className = "streamable-video";
        iframe.style.width = "100vw";
        iframe.style.height = "50vh";
        container.appendChild(iframe);
      
        streamableCount++;  // Increment the counter
    })
    .fail(function(data) {
        setTimeout(() => {
            load_streamable();
        }, Math.floor(Math.random() * 100));
    });
}

function start() {
    container.textContent = '';  // Clear the container
    streamableCount = 0;  // Reset the counter
    const numItems = Math.min(MAX, Number(setnumber.value));
    for (let i = 0; i < numItems; i++) {
        if (serviceSelector.value === "streamable") {
            load_streamable();
        } else {
            load_media();
        }
    }
}

start();

reload.addEventListener('click', () => {
    container.textContent = '';
    start();
});

function load_media() {
    const link = getLink();
    if (!links.has(link)) {
        if (serviceSelector.value === "imgur") {
            fetch(link)
            .then(res => res.ok ? res.blob() : Promise.reject(res))
            .then(blob => {
                const newImg = new Image();
                newImg.src = URL.createObjectURL(blob);
                newImg.className = "imgur-image";
                newImg.setAttribute("data-link", link);
                newImg.onload = () => {
                    if (newImg.naturalWidth === 161 && newImg.naturalHeight) {
                        load_media();
                        return;
                    }
                    container.appendChild(newImg);
                }
                newImg.onclick = () => window.open(link, '_blank').focus();
            })
            .catch(error => console.log('Something went wrong.', error));
       }
       links.add(link);
    }
}
