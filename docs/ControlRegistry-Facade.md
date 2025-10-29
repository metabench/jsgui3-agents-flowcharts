# ControlRegistry as Facade to Existing jsgui3 Control System

## Overview

After reviewing the jsgui3 source code, particularly `jsgui3-html`, it's clear that **ControlRegistry is not necessary as a separate entity**. The existing jsgui3 architecture already provides a robust control registration system. However, we can implement ControlRegistry as a **facade/adapter** that extends and enhances the existing system to support control-in-template features.

## Existing Control Registration System

### Core Components

1. **`jsgui.controls`** - Global control registry object
2. **`context.map_Controls`** - Context-specific control mappings
3. **`context.update_Controls()`** - Method to register controls in a context
4. **`parse_mount()`** - Template parser that uses `control_set` parameter

### Current Registration Patterns

```javascript
// Global registration
jsgui.controls.MyButton = class MyButton extends Control { ... }

// Context-specific registration
context.update_Controls({
    'mybutton': MyButtonClass
});

// Template parsing
parse_mount(template, target, jsgui.controls); // Uses global controls
```

## ControlRegistry as Facade

Instead of creating a separate registry, ControlRegistry should **wrap and extend** the existing system:

```javascript
// New file: html-core/ControlRegistry.js

class ControlRegistry {
    constructor(jsgui_instance = jsgui, context = null) {
        this.jsgui = jsgui_instance;
        this.context = context;
        this.aliases = new Map();
        this.namespaces = new Map();
    }

    // Register a control (facade to existing system)
    register(name, control_class, options = {}) {
        // Register in the appropriate control set
        const target = this.context ? this.context.map_Controls : this.jsgui.controls;
        target[name] = control_class;

        // Create kebab-case alias for template usage
        const kebab_name = this._to_kebab_case(name);
        if (kebab_name !== name) {
            this.aliases.set(kebab_name, name);
        }

        return this;
    }

    // Look up control (with alias resolution)
    get(name) {
        const resolved_name = this.aliases.get(name) || name;
        const target = this.context ? this.context.map_Controls : this.jsgui.controls;
        return target[resolved_name];
    }

    // Check if control exists
    has(name) {
        const resolved_name = this.aliases.get(name) || name;
        const target = this.context ? this.context.map_Controls : this.jsgui.controls;
        return !!target[resolved_name];
    }

    // Register controls from a namespace object
    register_namespace(namespace_obj, prefix = '') {
        Object.entries(namespace_obj).forEach(([name, control_class]) => {
            if (this._is_control_class(control_class)) {
                const full_name = prefix ? `${prefix}-${name}` : name;
                this.register(full_name, control_class);
            }
        });
        return this;
    }

    // Get control set for template parsing
    get_control_set() {
        return this.context ? this.context.map_Controls : this.jsgui.controls;
    }

    // Convert camelCase to kebab-case
    _to_kebab_case(str) {
        return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    }

    // Check if object is a control class
    _is_control_class(obj) {
        return typeof obj === 'function' &&
               obj.prototype &&
               (obj.prototype instanceof this.jsgui.Control || obj === this.jsgui.Control);
    }
}

// Global registry instance (facade to global jsgui.controls)
const global_control_registry = new ControlRegistry();

// Register core HTML controls
global_control_registry.register_namespace(jsgui.controls);
```

## Enhanced TemplateControl with Registry Integration

```javascript
// Enhanced html-core/TemplateControl.js

class TemplateControl extends Control {
    constructor(spec) {
        super(spec);
        this.template = spec.template;
        this.data_context = spec.data_context;
        this.binding_context = null;
        this.rendered = false;

        // Use registry if provided, otherwise create facade to existing system
        this.control_registry = spec.control_registry ||
            new ControlRegistry(this.jsgui, this.context);
    }

    async render_template() {
        if (this.rendered) return;

        // Get control set from registry (which may be facade to existing system)
        const control_set = this.control_registry.get_control_set();

        // Parse and mount template with control support
        const [depth_0_ctrls, res_controls] = await parse_mount(
            this.template,
            this,
            control_set, // Use registry's control set
            this.data_context,
            { control_registry: this.control_registry }
        );

        // Create binding context for reactive updates
        this.binding_context = new BindingContext(this.data_context, this.context);

        // Apply bindings to all controls
        this.apply_bindings_to_children(depth_0_ctrls);

        this.rendered = true;
    }
}
```

## Enhanced parse-mount.js for Control Tag Recognition

```javascript
// Enhanced parse-mount.js

const CONTROL_TAG_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$/;

const is_control_tag = (tag_name, control_registry) => {
    // Use registry to check if it's a registered control
    return control_registry && control_registry.has(tag_name);
};

const create_control_from_tag = (tag, content, context, binding_context, control_registry) => {
    // Get control class from registry
    const Ctrl = control_registry.get(tag.name);

    if (!Ctrl) {
        throw new Error(`Control '${tag.name}' not found in registry`);
    }

    const attribs = tag.attribs || {};
    const bindings = parse_binding_attributes(attribs);

    // Create control with regular attributes
    const ctrl = new Ctrl({ ...attribs, context });

    // Apply bindings if binding context provided
    if (binding_context && Object.keys(bindings).length > 0) {
        binding_context.apply_bindings_to_control(ctrl, bindings);
    }

    return ctrl;
};

// Update parse function to accept control_registry parameter
const parse = function(str_content, context, control_set, control_registry, callback) {
    // ... existing parsing logic ...

    const create_ctrl = (tag, content) => {
        // Check if it's a control tag using registry
        if (is_control_tag(tag.name, control_registry)) {
            return create_control_from_tag(tag, content, context, null, control_registry);
        }

        // Fall back to existing control_set lookup
        if (control_set[tag.name]) {
            let Ctrl = control_set[tag.name];
            // ... existing logic ...
        } else {
            throw 'lacking jsgui control for ' + tag.name;
        }
    };

    // ... rest of parsing logic ...
};
```

## Usage Examples

### Basic Control Registration

```javascript
// Register custom controls using the facade
const registry = new ControlRegistry();

// Register individual controls
registry.register('MyButton', MyButtonClass);
registry.register('DataGrid', DataGridClass);

// Register from namespace
registry.register_namespace(MyControls, 'my');

// Now available in templates as:
// <my-button>, <data-grid>, <my-custom-control>
```

### TemplateControl with Registry

```javascript
const flowchart_builder = new TemplateControl({
    template: `
        <div class="flowchart">
            <my-toolbar>
                <my-button data-bind-click="add_node">Add Node</my-button>
            </my-toolbar>
            <flowchart-canvas data-bind="nodes">
                <!-- Custom controls in templates -->
            </flowchart-canvas>
        </div>
    `,
    control_registry: registry, // Uses facade registry
    data_context: flowchart_data
});
```

## Benefits of Facade Approach

### 1. **Backward Compatibility**
- Existing `jsgui.controls` registrations continue to work
- No breaking changes to current applications
- Gradual adoption possible

### 2. **Enhanced Features**
- Automatic kebab-case aliasing for templates
- Namespace organization
- Centralized control management
- Better error messages

### 3. **Seamless Integration**
- Works with existing `parse_mount` function
- Compatible with context-specific control sets
- Extends rather than replaces existing patterns

### 4. **Performance**
- No additional lookup overhead
- Registry facade is lightweight
- Reuses existing control storage

## Implementation Phases

### Phase 1: Core Facade (Week 1)
- [ ] Create ControlRegistry as facade to existing system
- [ ] Implement kebab-case aliasing
- [ ] Add namespace registration methods

### Phase 2: Template Integration (Week 2)
- [ ] Enhance parse-mount for control tag recognition
- [ ] Update TemplateControl to use registry
- [ ] Add control registry parameter to parsing functions

### Phase 3: Enhanced Features (Week 3)
- [ ] Add control validation and error handling
- [ ] Implement lazy loading capabilities
- [ ] Add registry introspection methods

### Phase 4: Testing & Documentation (Week 4)
- [ ] Comprehensive test coverage
- [ ] Update documentation with facade patterns
- [ ] Migration guides for existing applications

## Conclusion

ControlRegistry should be implemented as a **facade/adapter** to the existing jsgui3 control system rather than a separate registry. This approach:

- **Leverages existing infrastructure** instead of duplicating it
- **Maintains backward compatibility** with current applications
- **Provides enhanced features** like automatic aliasing and namespaces
- **Enables control-in-template** functionality without breaking changes

The facade pattern allows us to extend jsgui3's proven control registration system while adding the template-specific enhancements needed for component-based templating.</content>
<parameter name="filePath">c:\Users\james\Documents\repos\jsgui3-agents-flowcharts\docs\ControlRegistry-Facade.md