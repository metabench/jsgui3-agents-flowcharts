const jsgui = require('./client');
const Server = require('jsgui3-server').Server;
const {Demo_UI} = jsgui.controls;



if (require.main === module) {

    const server = new Server({
        Ctrl: Demo_UI,
        //debug: true,
        // Giving it the Ctrl and disk path client js should enable to server to get the JS-bundled CSS from the file(s).
        //  Putting the JS files through proper parsing and into a syntax tree would be best.

        //'js_mode': 'debug',
        'src_path_client_js': require.resolve('./client.js'),
        //debug: true // should not minify the js, should include the symbols.
        //js_client: require.resolve('./square_box.js')
    });
    // A callback or event for when the bundling has been completed
    //  a 'ready' event.

    // then start the server....
    // be able to choose the port / ports?
    console.log('waiting for server ready event');
    server.on('ready', () => {
        console.log('server ready');

        // server start will change to observable?

        server.start(52000, function (err, cb_start) {
            if (err) {
                throw err;
            } else {
                // Should have build it by now...
    
                console.log('server started');
            }
        });
    })

    

}