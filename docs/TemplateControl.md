# TemplateControl

## Overview

`TemplateControl` is a base class that extends jsgui3's `Control` class to provide declarative template rendering with reactive data binding capabilities. It serves as the foundation for building reusable UI components that combine HTML-like templates with reactive data synchronization, enabling a component-based architecture within the jsgui3 framework.

## Enhanced Capabilities: Controls Within Templates

A major enhancement allows `TemplateControl` to use jsgui3 controls directly within templates, not just HTML elements. This enables true component-based templating:

```html
<!-- Mix HTML elements and custom controls -->
<div class="user-form">
  <h2 data-bind="user.name"></h2>
  <jsgui-textbox data-bind="user.email" placeholder="Email" />
  <jsgui-button data-bind-click="saveUser" text="Save" />
  <my-custom-control data-bind="customData" />
</div>
```

This leverages the existing parse-mount system to recognize control tags and instantiate the appropriate control classes while maintaining full data binding capabilities.

## Architecture

`TemplateControl` bridges three key concepts:

1. **Template Declaration**: HTML-like syntax for defining UI structure
2. **Reactive Data**: Observable data models that drive UI updates
3. **Control Composition**: jsgui3's existing control system for DOM manipulation

## Inheritance Hierarchy

```
Control (jsgui3-html)
  └── TemplateControl
      └── UserForm
      └── TodoList
      └── DataGrid
      └── FlowchartControl
```

## Constructor

```javascript
class TemplateControl extends Control {
    constructor(spec = {}) {
        super(spec);

        this.template = spec.template || '';
        this.data_context = spec.data_context || {};
        this.methods = spec.methods || {};
        this.computed = spec.computed || {};
        this.watchers = spec.watchers || [];

        this.rendered = false;
        this.binding_context = null;
        this.rendered_controls = [];

        this.setup_computed_properties();
        this.setup_watchers();
        this.bind_methods();
    }
}
```

## Key Properties

### template

The HTML-like template string that defines the component's UI structure.

```javascript
this.template = `
<div class="user-profile">
  <h2 data-bind="user.name"></h2>
  <p data-bind="user.email"></p>
  <button data-bind-click="editProfile">Edit</button>
</div>
`;
```

### data_context

The reactive data model that drives the template rendering.

```javascript
this.data_context = new Data_Object({
    user: new Data_Object({
        name: 'John Doe',
        email: 'john@example.com'
    }),
    is_editing: false
});
```

### methods

Component methods that can be called from templates via `data-bind-click`.

```javascript
this.methods = {
    editProfile: function() {
        this.data_context.is_editing = true;
    },

    saveProfile: function() {
        // Save logic here
        this.data_context.is_editing = false;
    }
};
```

### computed

Reactive computed properties that automatically update when dependencies change.

```javascript
this.computed = {
    display_name: {
        deps: ['user.first_name', 'user.last_name'],
        fn: function() {
            return `${this.user.first_name} ${this.user.last_name}`;
        }
    },

    is_valid: {
        deps: ['user.email'],
        fn: function() {
            return this.user.email && this.user.email.includes('@');
        }
    }
};
```

## Core Methods

### render_template()

Renders the template using parse-mount and sets up data bindings.

```javascript
async render_template() {
    if (this.rendered) return;

    try {
        // Parse and mount the template
        const result = await parse_mount_reactive(
            this.template,
            this,
            this.context.control_set,
            this.data_context
        );

        this.rendered_controls = result.controls;
        this.binding_context = result.binding_context;
        this.rendered = true;

        // Emit render complete event
        this.raise('render-complete', { controls: result.controls });

    } catch (error) {
        console.error('Template rendering error:', error);
        this.raise('render-error', { error });
        throw error;
    }
}
```

### update_data_context(new_context)

Updates the data context and triggers reactive re-rendering.

```javascript
update_data_context(new_context) {
    // Merge with existing context
    Object.assign(this.data_context, new_context);

    // Update binding context if it exists
    if (this.binding_context) {
        this.binding_context.update_data_model(this.data_context);
    }

    // Trigger computed property updates
    this.update_computed_properties();

    this.raise('data-updated', { context: this.data_context });
}
```

### setup_computed_properties()

Initializes computed properties with dependency tracking.

```javascript
setup_computed_properties() {
    Object.entries(this.computed).forEach(([name, config]) => {
        const { deps, fn } = config;

        // Create computed property using lang-tools
        this.data_context[name] = new ComputedProperty(
            this.data_context,
            deps,
            fn.bind(this.data_context),
            { context: this }
        );
    });
}
```

### setup_watchers()

Sets up property watchers for reactive side effects.

```javascript
setup_watchers() {
    this.watchers.forEach(watcher_config => {
        const { property, handler, options = {} } = watcher_config;

        const watcher = this.data_context.watch(
            property,
            handler.bind(this),
            options
        );

        // Store for cleanup
        this._watchers = this._watchers || [];
        this._watchers.push(watcher);
    });
}
```

### bind_methods()

Binds component methods to the control instance.

```javascript
bind_methods() {
    Object.keys(this.methods).forEach(method_name => {
        this[method_name] = this.methods[method_name].bind(this);
    });
}
```

## Template Syntax

### Control Tags

In addition to HTML elements, templates can include custom control tags that will be instantiated as jsgui3 controls:

```html
<!-- Built-in jsgui controls -->
<jsgui-button text="Click me" data-bind-click="handleClick" />
<jsgui-textbox data-bind="user.name" placeholder="Enter name" />
<jsgui-checkbox data-bind="user.agreed" label="I agree" />

<!-- Custom registered controls -->
<my-button variant="primary" data-bind-click="save" />
<user-profile data-bind="userData" />
<data-table data-bind="tableData" on-row-selected="handleSelection" />
```

### Control Registration

Controls can be registered globally or locally within a TemplateControl:

```javascript
// Global registration
TemplateControl.register_global_component('my-button', MyButton);

// Local registration (available only in this control's templates)
class MyForm extends TemplateControl {
    constructor(spec) {
        super({
            ...spec,
            components: {
                'custom-input': CustomInput,
                'validation-message': ValidationMessage
            }
        });
    }
}
```

### Control Property Binding

Controls support the same data binding directives as HTML elements:

```html
<!-- Control properties -->
<jsgui-textbox 
  data-bind="user.name" 
  placeholder="Enter name"
  data-bind-enabled="form.enabled"
  data-bind-required="user.nameRequired" />

<!-- Control events -->
<jsgui-button 
  text="Save"
  data-bind-click="saveUser"
  data-bind-disabled="isSaving" />

<!-- Control styling -->
<jsgui-panel 
  data-bind-class="{'expanded': isExpanded}"
  data-bind-style="'height: ' + panelHeight + 'px'" />
```

```html
<!-- One-way data binding -->
<span data-bind="user.name"></span>

<!-- Two-way data binding -->
<input type="text" data-bind="user.name" data-bind-mode="two-way">

<!-- Expression binding -->
<div data-bind="'Welcome, ' + user.name + '!'"></div>
```

### Event Binding

```html
<!-- Method calls -->
<button data-bind-click="saveUser">Save</button>

<!-- Method calls with parameters -->
<button data-bind-click="removeItem(item)">Remove</button>

<!-- Inline expressions -->
<button data-bind-click="count = count + 1">Increment</button>
```

### Conditional Rendering

```html
<!-- Show/hide based on condition -->
<div data-bind-if="user.is_admin">
  <span>Admin Panel</span>
</div>

<!-- Opposite condition -->
<div data-bind-if="!user.is_loading">
  <span>Content loaded</span>
</div>
```

### Collection Rendering

```html
<!-- Render arrays -->
<ul data-bind-each="user.hobbies">
  <li data-bind="item.name"></li>
</ul>

<!-- With index access -->
<ul data-bind-each="items">
  <li data-bind="index + 1 + '. ' + item.name"></li>
</ul>
```

### Dynamic Styling

```html
<!-- Dynamic classes -->
<div data-bind-class="{'active': item.selected, 'error': item.has_error}">
  Item content
</div>

<!-- Dynamic styles -->
<div data-bind-style="'background-color: ' + item.color + '; color: white'">
  Colored item
</div>
```

## Advanced Features

### Lifecycle Hooks

```javascript
class CustomControl extends TemplateControl {
    constructor(spec) {
        super(spec);
    }

    // Called before template rendering
    before_render() {
        // Setup logic
    }

    // Called after template rendering
    after_render() {
        // Post-render logic
    }

    // Called when data updates
    on_data_change(changes) {
        // React to data changes
    }
}
```

### Component Communication

#### Props System

```javascript
class ChildComponent extends TemplateControl {
    static get props() {
        return {
            title: { type: String, default: 'Default Title' },
            items: { type: Array, default: () => [] },
            onSelect: { type: Function }
        };
    }

    constructor(spec) {
        super(spec);
        this.setup_props();
    }

    setup_props() {
        const props_def = this.constructor.props;

        Object.keys(props_def).forEach(prop_name => {
            const def = props_def[prop_name];

            Object.defineProperty(this, prop_name, {
                get: () => this._props[prop_name],
                set: (value) => {
                    this._props[prop_name] = value;
                    this.validate_prop(prop_name, value, def);
                    this.on_prop_change(prop_name, value);
                }
            });
        });
    }
}
```

#### Emit System

```javascript
// In child component
select_item(item) {
    this.$emit('item-selected', item);
}

// In parent template
<child-component on_item_selected="handleSelection" />
```

#### Control Events

Controls can emit events that bubble up through the template hierarchy:

```javascript
class DataTable extends TemplateControl {
    constructor(spec) {
        super(spec);
        
        this.template = `
        <div class="data-table">
          <table data-bind-each="items">
            <tr data-bind-click="select_row(item)">
              <td data-bind="item.name"></td>
              <td data-bind="item.value"></td>
            </tr>
          </table>
        </div>
        `;
        
        this.methods = {
            select_row: (item) => {
                this.$emit('row-selected', item);
            }
        };
    }
}
```

### Reactive Arrays

Special handling for array data with automatic DOM updates.

```javascript
// In component
this.data_context.items = new ReactiveArray([
    { name: 'Item 1' },
    { name: 'Item 2' }
]);

// Template
<ul data-bind-each="items">
  <li data-bind="item.name"></li>
</ul>

// Usage
this.data_context.items.push({ name: 'Item 3' }); // Automatically updates DOM
```

## Integration with Flowchart Control

`TemplateControl` is particularly valuable for the Flowchart Control, enabling complex UI composition with custom controls:

```javascript
class FlowchartControl extends TemplateControl {
    constructor(spec) {
        super(spec);

        this.template = `
        <div class="flowchart-container">
          <svg class="flowchart-canvas" data-bind-style="'width: ' + canvas.width + 'px; height: ' + canvas.height + 'px'">
            <!-- Nodes using custom controls -->
            <g data-bind-each="nodes" class="nodes">
              <flowchart-node 
                data-bind="item"
                data-bind-class="{'selected': item.selected}"
                on-node-move="handle_node_move"
                on-node-select="handle_node_select">
              </flowchart-node>
            </g>

            <!-- Connections using custom controls -->
            <g data-bind-each="connections" class="connections">
              <flowchart-connection 
                data-bind="item"
                from-node="find_node(item.from)"
                to-node="find_node(item.to)">
              </flowchart-connection>
            </g>
          </svg>

          <!-- Toolbar with custom controls -->
          <flowchart-toolbar 
            on-add-node="add_node"
            on-delete-selected="delete_selected"
            on-save="save_flowchart"
            data-bind-disabled="is_readonly">
          </flowchart-toolbar>
        </div>
        `;

        this.data_context = reactive({
            nodes: new ReactiveArray([]),
            connections: new ReactiveArray([]),
            canvas: { width: 800, height: 600 },
            selected_node: null,
            is_readonly: false
        });

        this.methods = {
            add_node: () => this.add_new_node(),
            delete_selected: () => this.delete_selected_node(),
            save_flowchart: () => this.save_flowchart(),
            find_node: (id) => this.find_node(id),
            handle_node_move: (node, position) => this.handle_node_move(node, position),
            handle_node_select: (node) => this.handle_node_select(node)
        };
    }

    add_new_node() {
        const node = {
            id: Date.now(),
            text: 'New Node',
            x: Math.random() * 400,
            y: Math.random() * 300,
            selected: false
        };
        this.data_context.nodes.push(node);
    }

    handle_node_select(node) {
        // Update selection state
        this.data_context.nodes.forEach(n => n.selected = false);
        node.selected = true;
        this.data_context.selected_node = node;
    }
}
```

### Custom Flowchart Controls

```javascript
// FlowchartNode control
class FlowchartNode extends TemplateControl {
    static get props() {
        return {
            node: { type: Object, required: true },
            selected: { type: Boolean, default: false }
        };
    }

    constructor(spec) {
        super({
            ...spec,
            template: `
            <g class="flowchart-node" 
               data-bind-transform="'translate(' + node.x + ',' + node.y + ')'"
               data-bind-class="{'selected': selected}">
              <rect width="100" height="50" rx="5" fill="#fff" stroke="#333" />
              <text x="50" y="30" text-anchor="middle" data-bind="node.text"></text>
              
              <!-- Connection points -->
              <circle cx="0" cy="25" r="3" class="connection-point" />
              <circle cx="100" cy="25" r="3" class="connection-point" />
            </g>
            `
        });
    }
}

// Register the control
TemplateControl.register_component('flowchart-node', FlowchartNode);
```

## Performance Considerations

### Template Compilation Caching

```javascript
static compiled_templates = new Map();

static get_compiled_template(template_string) {
    if (!this.compiled_templates.has(template_string)) {
        this.compiled_templates.set(
            template_string,
            this.compile_template(template_string)
        );
    }
    return this.compiled_templates.get(template_string);
}
```

### Selective Updates

```javascript
// Only re-render when necessary
should_update(changes) {
    // Check if changes affect visible parts of template
    return changes.some(change =>
        this.binding_context.get_data_dependencies()
            .some(dep => this.paths_related(change.path, dep))
    );
}
```

### Memory Management

```javascript
destroy() {
    // Clean up binding context
    if (this.binding_context) {
        this.binding_context.destroy();
    }

    // Clean up watchers
    if (this._watchers) {
        this._watchers.forEach(watcher => watcher.destroy());
    }

    // Clean up rendered controls
    this.rendered_controls.forEach(control => {
        if (control.destroy) control.destroy();
    });

    super.destroy();
}
```

## Error Handling

### Template Compilation Errors

```javascript
async render_template() {
    try {
        // ... render logic
    } catch (error) {
        if (error.name === 'TemplateParseError') {
            console.error('Template syntax error:', error.message);
            this.render_error_state(error);
        } else {
            throw error;
        }
    }
}
```

### Data Binding Errors

```javascript
safe_method_call(method_name, ...args) {
    const method = this.methods[method_name];
    if (!method) {
        console.warn(`Method ${method_name} not found`);
        return;
    }

    try {
        return method.apply(this, args);
    } catch (error) {
        console.error(`Error in method ${method_name}:`, error);
        this.handle_method_error(error, method_name, args);
    }
}
```

## Testing

### Component Testing

```javascript
describe('TemplateControl', () => {
    it('should render template correctly', async () => {
        const control = new TestControl({
            template: '<div data-bind="message"></div>',
            data_context: { message: 'Hello' }
        });

        await control.render_template();

        expect(control.dom.el.textContent).toBe('Hello');
    });

    it('should handle method binding', async () => {
        let called = false;
        const control = new TestControl({
            template: '<button data-bind-click="test_method">Click</button>',
            data_context: {},
            methods: {
                test_method: () => called = true
            }
        });

        await control.render_template();

        const button = control.dom.el.querySelector('button');
        button.click();

        expect(called).toBe(true);
    });
});
```

### Integration Testing

```javascript
describe('TemplateControl Integration', () => {
    it('should update on data changes', async () => {
        const control = new TestControl({
            template: '<span data-bind="count"></span>',
            data_context: new Data_Value(0)
        });

        await control.render_template();

        control.data_context.value = 5;
        // Trigger change event
        await next_tick();

        expect(control.dom.el.textContent).toBe('5');
    });
});
```

## Best Practices

### Template Organization

```javascript
// Good: Separate template from logic
class UserProfile extends TemplateControl {
    get template() {
        return `
        <div class="profile">
          <h1 data-bind="user.name"></h1>
          <p data-bind="user.bio"></p>
        </div>
        `;
    }
}

// Better: External template files
class UserProfile extends TemplateControl {
    async load_template() {
        this.template = await this.load_template_file('user-profile.html');
    }
}
```

### Data Management

```javascript
// Good: Use reactive data structures
this.data_context = new Data_Object({
    user: new Data_Object({ name: '', email: '' }),
    settings: new Data_Object({ theme: 'light' })
});

// Better: Separate data logic
class UserProfile extends TemplateControl {
    setup_data() {
        this.user_data = new UserDataModel();
        this.settings = new SettingsModel();

        this.data_context = reactive({
            user: this.user_data,
            settings: this.settings,
            computed: {
                display_name: () => `${this.user.first_name} ${this.user.last_name}`
            }
        });
    }
}
```

### Method Organization

```javascript
// Good: Group related methods
this.methods = {
    // User actions
    save_profile: () => this.save_profile(),
    cancel_edit: () => this.cancel_edit(),

    // Data manipulation
    add_tag: (tag) => this.add_tag(tag),
    remove_tag: (tag) => this.remove_tag(tag)
};
```

## Conclusion

`TemplateControl` provides a powerful foundation for building reactive, component-based UIs within the jsgui3 framework. By combining declarative templates with reactive data binding and the existing control system, it enables developers to create complex, interactive applications while maintaining jsgui3's performance and architectural benefits.

The class serves as a bridge between traditional jsgui3 development and modern reactive UI patterns, making it an essential component for advanced applications like the Flowchart Control.</content>
<parameter name="filePath">c:\Users\james\Documents\repos\jsgui3-agents-flowcharts\docs\TemplateControl.md