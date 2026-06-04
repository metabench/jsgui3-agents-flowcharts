const jsgui = require('jsgui3-client');
const {controls, Control, mixins} = jsgui;
const {dragable} = mixins;
const {Text_Node} = jsgui;
const {SVGArrowCalculator, Point} = require('./svg-arrow-calculator');

// Flowchart_Task class - represents a task/action in the flowchart
class Flowchart_Task extends Control {
    constructor(spec = {}) {
        spec.__type_name = 'flowchart_task';
        super(spec);
        const {context} = this;

        // Add CSS classes
        this.add_class('flowchart-task');

        // Add text content
        if (spec.text) {
            const textNode = new Text_Node({
                context: context,
                text: spec.text
            });
            this.add(textNode);
        }
    }
}

// Flowchart_Decision class - represents a decision point in the flowchart
class Flowchart_Decision extends Control {
    constructor(spec = {}) {
        spec.__type_name = 'flowchart_decision';
        super(spec);
        const {context} = this;

        // Add CSS classes
        this.add_class('flowchart-decision');

        // Add text content with counter-rotation to keep it horizontal
        if (spec.text) {
            const textContainer = new Control({
                context: context,
                tagName: 'div',
                class: 'flowchart-decision-text'
            });

            const textNode = new Text_Node({
                context: context,
                text: spec.text
            });
            textContainer.add(textNode);
            this.add(textContainer);
        }
    }
}

// Flowchart_Connection class - represents connections between flowchart elements with SVG arrows
class Flowchart_Connection extends Control {
    constructor(spec = {}) {
        spec.__type_name = 'flowchart_connection';
        super(spec);
        const {context} = this;

        // Add CSS classes
        this.add_class('flowchart-connection');

        // Initialize arrow calculator
        this.arrowCalculator = new SVGArrowCalculator();

        // Create SVG element for the arrow
        this.svg = new Control({
            context: context,
            tagName: 'svg',
            class: 'flowchart-arrow'
        });

        // Create arrow path
        this.path = new Control({
            context: context,
            tagName: 'path',
            class: 'flowchart-arrow-path'
        });

        // Set initial path attributes
        this.path.dom.attributes.stroke = '#3498db';
        this.path.dom.attributes['stroke-width'] = '3';
        this.path.dom.attributes.fill = 'none';
        this.path.dom.attributes['marker-end'] = 'url(#arrowhead)';

        // Add marker definition for arrowhead
        const defs = new Control({
            context: context,
            tagName: 'defs'
        });

        const marker = new Control({
            context: context,
            tagName: 'marker',
            class: 'flowchart-arrow-marker'
        });

        marker.dom.attributes.id = 'arrowhead';
        marker.dom.attributes.markerWidth = '10';
        marker.dom.attributes.markerHeight = '7';
        marker.dom.attributes.refX = '9';
        marker.dom.attributes.refY = '3.5';
        marker.dom.attributes.orient = 'auto';

        const polygon = new Control({
            context: context,
            tagName: 'polygon',
            class: 'flowchart-arrow-polygon'
        });

        polygon.dom.attributes.points = '0 0, 10 3.5, 0 7';
        polygon.dom.attributes.fill = '#3498db';

        marker.add(polygon);
        defs.add(marker);
        this.svg.add(defs);
        this.svg.add(this.path);

        this.add(this.svg);

        // Store context for use in setSegments label rendering
        this._ctx = context;
    }

    /**
      * Set the arrow path between two node objects
      */
     setArrow(fromNode, toNode) {
         const arrowSpec = this.arrowCalculator.createArrow(fromNode, toNode);

         // Update SVG attributes
         this.svg.dom.attributes.width = arrowSpec.boundingBox.width + 'px';
         this.svg.dom.attributes.height = arrowSpec.boundingBox.height + 'px';
         this.svg.dom.attributes.viewBox = `0 0 ${arrowSpec.boundingBox.width} ${arrowSpec.boundingBox.height}`;

         // Update path
         this.path.dom.attributes.d = arrowSpec.pathData;

         // Update positioning
         this.style({
             position: 'absolute',
             left: arrowSpec.boundingBox.x + 'px',
             top: arrowSpec.boundingBox.y + 'px',
             width: arrowSpec.boundingBox.width + 'px',
             height: arrowSpec.boundingBox.height + 'px'
         });

         return arrowSpec;
     }

     /**
      * Set arrow path using pre-calculated segments (for straighter lines)
      */
     setSegments(segments, label) {
         if (!segments || segments.length === 0) return;

         // Calculate bounding box for all segments
         let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

         segments.forEach(segment => {
             minX = Math.min(minX, segment.start[0], segment.end[0]);
             minY = Math.min(minY, segment.start[1], segment.end[1]);
             maxX = Math.max(maxX, segment.start[0], segment.end[0]);
             maxY = Math.max(maxY, segment.start[1], segment.end[1]);
         });

         // Add padding
         const padding = 20;
         minX -= padding;
         minY -= padding;
         maxX += padding;
         maxY += padding;

         const width = maxX - minX;
         const height = maxY - minY;

         // Create SVG path data from segments
         let pathData = '';
         segments.forEach((segment, index) => {
             const startX = segment.start[0] - minX;
             const startY = segment.start[1] - minY;
             const endX = segment.end[0] - minX;
             const endY = segment.end[1] - minY;

             if (index === 0) {
                 pathData += `M ${startX} ${startY}`;
             }
             pathData += ` L ${endX} ${endY}`;
         });

         // Update SVG attributes
         this.svg.dom.attributes.width = width + 'px';
         this.svg.dom.attributes.height = height + 'px';
         this.svg.dom.attributes.viewBox = `0 0 ${width} ${height}`;

         // Update path
         this.path.dom.attributes.d = pathData;

         // Render connection label (e.g. "Yes"/"No" on decision branches)
         if (label && this._ctx) {
             // Find the best segment for label placement — prefer horizontal segments
             // (since multiple connections may share the same vertical exit from a decision)
             let label_seg = segments[0];
             for (let i = 0; i < segments.length; i++) {
                 if (segments[i].type === 'horizontal') {
                     label_seg = segments[i];
                     break;
                 }
             }
             let label_x, label_y;

             if (label_seg.type === 'horizontal') {
                 // Place label at the midpoint of the horizontal segment, above the line
                 label_x = ((label_seg.start[0] + label_seg.end[0]) / 2 - minX);
                 label_y = (label_seg.start[1] - minY) - 6;
             } else {
                 // Vertical segment — place label to the right of the midpoint
                 label_x = (label_seg.start[0] - minX) + 8;
                 label_y = ((label_seg.start[1] + label_seg.end[1]) / 2 - minY);
             }

             const text_el = new Control({
                 context: this._ctx,
                 tagName: 'text'
             });
             text_el.add_class('flowchart-connection-label');
             text_el.dom.attributes.x = label_x.toFixed(1);
             text_el.dom.attributes.y = label_y.toFixed(1);
             text_el.dom.attributes['text-anchor'] = 'start';
             text_el.dom.attributes.fill = '#ffffff';
             text_el.dom.attributes['font-size'] = '13';
             text_el.dom.attributes['font-family'] = 'Arial, sans-serif';
             text_el.dom.attributes['font-weight'] = 'bold';

             const text_node = new Text_Node({
                 context: this._ctx,
                 text: label
             });
             text_el.add(text_node);
             this.svg.add(text_el);
         }

         // Update positioning
         this.style({
             position: 'absolute',
             left: minX + 'px',
             top: minY + 'px',
             width: width + 'px',
             height: height + 'px'
         });

         return { x: minX, y: minY, width, height };
     }

    /**
     * Set arrow style properties
     */
    setArrowStyle(style) {
        if (style.stroke) this.path.dom.attributes.stroke = style.stroke;
        if (style.strokeWidth) this.path.dom.attributes['stroke-width'] = style.strokeWidth;
        if (style.markerEnd) this.path.dom.attributes['marker-end'] = style.markerEnd;
    }
}

// Register the controls
controls.Flowchart_Task = Flowchart_Task;
controls.Flowchart_Decision = Flowchart_Decision;
controls.Flowchart_Connection = Flowchart_Connection;

module.exports = {
    Flowchart_Task,
    Flowchart_Decision,
    Flowchart_Connection
};