/**
 * SVG Arrow Calculator Module
 * Provides precise mathematical calculations for SVG arrow paths and positioning
 */

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(other) {
        return new Point(this.x + other.x, this.y + other.y);
    }

    subtract(other) {
        return new Point(this.x - other.x, this.y - other.y);
    }

    multiply(scalar) {
        return new Point(this.x * scalar, this.y * scalar);
    }

    distance(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    normalize() {
        const length = this.distance(new Point(0, 0));
        if (length === 0) return new Point(0, 0);
        return new Point(this.x / length, this.y / length);
    }

    toString() {
        return `${this.x},${this.y}`;
    }
}

class SVGArrowCalculator {
    constructor(options = {}) {
        this.options = {
            arrowSize: options.arrowSize || 10,
            strokeWidth: options.strokeWidth || 3,
            curvature: options.curvature || 0.3, // How curved the lines are (0-1)
            padding: options.padding || 20, // Padding around the arrow bounding box
            ...options
        };
    }

    /**
     * Calculate connection points for different node types
     */
    getConnectionPoint(nodeType, position, size, direction) {
        const [x, y] = position;
        const [width, height] = size;

        switch (nodeType) {
            case 'task':
                switch (direction) {
                    case 'top': return new Point(x + width/2, y);
                    case 'bottom': return new Point(x + width/2, y + height);
                    case 'left': return new Point(x, y + height/2);
                    case 'right': return new Point(x + width, y + height/2);
                    default: return new Point(x + width/2, y + height/2);
                }
            case 'decision':
                // For diamonds, connection points are at the edges
                const centerX = x + width/2;
                const centerY = y + height/2;
                switch (direction) {
                    case 'top': return new Point(centerX, y);
                    case 'bottom': return new Point(centerX, y + height);
                    case 'left': return new Point(x, centerY);
                    case 'right': return new Point(x + width, centerY);
                    default: return new Point(centerX, centerY);
                }
            default:
                return new Point(x + width/2, y + height/2);
        }
    }

    /**
     * Calculate the direction from one point to another
     */
    getDirection(from, to) {
        const vector = to.subtract(from);
        const angle = Math.atan2(vector.y, vector.x) * 180 / Math.PI;

        if (angle >= -45 && angle < 45) return 'right';
        if (angle >= 45 && angle < 135) return 'bottom';
        if (angle >= 135 || angle < -135) return 'left';
        return 'top';
    }

    /**
     * Calculate control points for a smooth Bézier curve
     */
    calculateControlPoints(start, end, curvature = this.options.curvature) {
        const vector = end.subtract(start);
        const distance = start.distance(end);

        // Perpendicular vector for control point offset
        const perpendicular = new Point(-vector.y, vector.x).normalize();

        // Control point distance from start/end points
        const controlDistance = distance * curvature;

        const cp1 = start.add(vector.multiply(0.3)).add(perpendicular.multiply(controlDistance));
        const cp2 = start.add(vector.multiply(0.7)).subtract(perpendicular.multiply(controlDistance));

        return { cp1, cp2 };
    }

    /**
     * Generate SVG path data for an arrow
     */
    generateArrowPath(start, end, options = {}) {
        const curvature = options.curvature || this.options.curvature;
        const { cp1, cp2 } = this.calculateControlPoints(start, end, curvature);

        // Generate cubic Bézier curve path
        const pathData = `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;

        return pathData;
    }

    /**
     * Calculate the bounding box for an arrow path
     */
    calculateBoundingBox(start, end, options = {}) {
        const curvature = options.curvature || this.options.curvature;
        const { cp1, cp2 } = this.calculateControlPoints(start, end, curvature);

        const points = [start, cp1, cp2, end];
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);

        const minX = Math.min(...xs) - this.options.padding;
        const maxX = Math.max(...xs) + this.options.padding;
        const minY = Math.min(...ys) - this.options.padding;
        const maxY = Math.max(...ys) + this.options.padding;

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Calculate relative coordinates for SVG viewport
     */
    calculateRelativeCoordinates(start, end, boundingBox) {
        return {
            start: new Point(start.x - boundingBox.x, start.y - boundingBox.y),
            end: new Point(end.x - boundingBox.x, end.y - boundingBox.y)
        };
    }

    /**
      * Create a complete arrow specification
      */
     createArrow(fromNode, toNode) {
         // Calculate center points for direction determination
         const fromCenter = new Point(
             fromNode.position[0] + fromNode.size[0] / 2,
             fromNode.position[1] + fromNode.size[1] / 2
         );
         const toCenter = new Point(
             toNode.position[0] + toNode.size[0] / 2,
             toNode.position[1] + toNode.size[1] / 2
         );

         // Determine connection directions
         const fromDirection = this.getDirection(fromCenter, toCenter);
         const toDirection = fromDirection === 'bottom' ? 'top' :
                            fromDirection === 'top' ? 'bottom' :
                            fromDirection === 'right' ? 'left' : 'right';

         // Get connection points
         const startPoint = this.getConnectionPoint(fromNode.type, fromNode.position, fromNode.size, fromDirection);
         const endPoint = this.getConnectionPoint(toNode.type, toNode.position, toNode.size, toDirection);

         // Calculate bounding box
         const boundingBox = this.calculateBoundingBox(startPoint, endPoint);

         // Calculate relative coordinates
         const relativeCoords = this.calculateRelativeCoordinates(startPoint, endPoint, boundingBox);

         // Generate path
         const pathData = this.generateArrowPath(relativeCoords.start, relativeCoords.end);

         return {
             boundingBox,
             pathData,
             startPoint,
             endPoint,
             relativeStart: relativeCoords.start,
             relativeEnd: relativeCoords.end
         };
     }

    /**
     * Create SVG marker definition for arrowhead
     */
    createArrowMarker(id = 'arrowhead', options = {}) {
        const size = options.size || this.options.arrowSize;
        const color = options.color || '#3498db';

        return {
            id,
            markerWidth: size,
            markerHeight: size * 0.7,
            refX: size * 0.9,
            refY: size * 0.35,
            orient: 'auto',
            polygon: {
                points: `0 0, ${size} ${size * 0.35}, 0 ${size * 0.7}`,
                fill: color
            }
        };
    }
}

module.exports = {
    SVGArrowCalculator,
    Point
};