const jsgui = require('jsgui3-client');
const {controls, Control, mixins} = jsgui;
const {dragable} = mixins;

const Active_HTML_Document = require('jsgui3-server/controls/Active_HTML_Document');

// Maybe better to include it within an Active_HTML_Document.

// Is currently a decent demo of a small active control running from the server, activated on the client.
//   This square box is really simple, and it demonstrates the principle of the code for the draggable square box not being all that complex
//   compared to a description of it.

// A container with reorderable internal draggable items could help.

// would be nice to be able to have all code in 1 file...???
//  Though the sever code should be separate.


// Relies on extracting CSS from JS files.
// Usage of windows should be very easy on this level.


class Demo_UI extends Active_HTML_Document {
    constructor(spec = {}) {
        spec.__type_name = 'demo_ui';
        super(spec);
        const {context} = this;
        
        this.add_class('demo-ui');

        const compose = () => {
            // put 20 of them in place.

            // Then how to arrange them...?

            const window = new controls.Window({
                context: context,
                title: 'jsgui3-html Window Control',
                pos: [10, 10]
            })
            this.add(window);

            


        }
        if (!spec.el) {
            compose();
        }
    }
}

// Include this in bundling.
//  Want CSS bundling so that styles are read out from the JS document and compiled to a stylesheet.
/*...*/

//controls.Demo_UI = Demo_UI;

// A css file may be an easier way to get started...?
//  Want to support but not require css in js.

// But need to set up the serving of the CSS both on the server, and on the client.
//  Ofc setting it up on the server first is important - then can that stage set it up in the doc sent to the client?

// Including the CSS from the JS like before.
//  Needs to extract the CSS and serve it as a separate CSS file.
//  Should also have end-to-end regression tests so this does not break again in the future.
//   The code was kind of clunky and got refactored away.
//   

// Would need to parse the JS files to extract the CSS.
//  Maybe could do it an easier way??? Now that it's easy, want a faster way.


Demo_UI.css = `

* {
    margin: 0;
    padding: 0;
}

body {
    overflow-x: hidden;
    overflow-y: hidden;
    background-color: #E0E0E0;
}

.demo-ui {
    
    /* 

    display: flex;
    flex-wrap: wrap;
    
    flex-direction: column; 
    justify-content: center;
    align-items: center;
    text-align: center;
    min-height: 100vh;
    */
    
}
`;

controls.Demo_UI = Demo_UI;
module.exports = jsgui;