const jsgui = require('./client');
const Server = require('jsgui3-server').Server;
const {Demo_UI} = jsgui.controls;

const server = new Server({
    Ctrl: Demo_UI,
    'src_path_client_js': require.resolve('./client.js'),
});

server.on('ready', () => {
    console.log('Server ready, rendering HTML...');

    // Access the webpage from the server
    const websiteResource = server.resource_pool.get_resource('Website_Resource - Single Webpage');
    console.log('websiteResource:', websiteResource);
    console.log('websiteResource properties:', Object.keys(websiteResource));
    console.log('Ctrl from server:', server.Ctrl);

    // Use the Ctrl directly from server
    const Ctrl = server.Ctrl;

    // Create control instance and render HTML
    const ctrl = new Ctrl();
    const html = ctrl.all_html_render();

    console.log('Rendered HTML:');
    console.log('================');
    console.log(html);
    console.log('================');

    process.exit(0);
});