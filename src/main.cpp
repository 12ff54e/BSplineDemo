#include <emscripten/html5.h>  // for H5 event handling
#include <webgl/webgl2.h>      // for all the gl* staff
#include <fstream>             // for reading shader source
#include <iostream>            // for output in console
#include <memory>              // for std::unique_ptr
#include <string>              // for string compare in key code
#include "Interpolation.hpp"   // for interpoaltion
#include "Shader.hpp"          // for shader management
#include "Vec.hpp"             // general purpose linear algebra type

#define canvas "#canvas"             // canvas query selector
using coord_type = float;            // canvas coordinate type
using pt_type = Vec<2, coord_type>;  // canvas position type

constexpr int canvas_width = 800;
constexpr int canvas_height = 600;
constexpr coord_type close_threshold = 10;

// vertex array buffer
static GLuint vao;
// uniform buffer id
static GLuint ubo;
// location of uniform var control_point_size
static GLint control_point_size_loc;
// location of uniform var periodic
static GLint periodic_loc;
// location of uniform var visible
static GLint visible_loc;
// location of uniform var filled
static GLint filled_loc;

static pt_type current_pt;
static GLint spline_closed = 0;
static GLint spline_filled = 0;

#define exec_and_check(func, ...)                             \
    do {                                                      \
        if (func(__VA_ARGS__) != EMSCRIPTEN_RESULT_SUCCESS) { \
            std::cout << "Failed to invoke" #func << '\n';    \
            return 1;                                         \
        }                                                     \
    } while (false)

static std::vector<pt_type>& get_data() {
    static std::vector<pt_type> data;
    return data;
}

// main loop
static void draw() {
    // set background color to grey
    glClearColor(0.3f, 0.3f, 0.3f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT);

    constexpr float ar =
        static_cast<float>(canvas_width) / static_cast<float>(canvas_height);
    auto clip_x = [](coord_type x) -> float {
        return static_cast<float>(x) / static_cast<float>(canvas_height) -
               .5f * ar;
    };
    auto clip_y = [](coord_type y) -> float {
        return .5f - static_cast<float>(y) / static_cast<float>(canvas_height);
    };

    // prepare data for pending spline when the actual spline is not closed
    if (!(spline_closed & 1)) {
        // hint for forming a closed spline, note that coordinates are in
        // pixel
        if ((current_pt - get_data().front()).mag() < close_threshold) {
            // set 2nd spline to be closed
            spline_closed |= 2;
            current_pt = get_data().front();
        } else {
            // unset bit
            spline_closed &= ~2;
        }
    }
    get_data().push_back(current_pt);

    // pad every point to a vec4
    std::size_t padded_data_size = get_data().size() * 4;
    std::unique_ptr<float[]> ptr(new float[padded_data_size]{});
    if (get_data().size() >= 3) {
        intp::InterpolationFunction1D<pt_type, coord_type> origin_vec_spline(
            std::make_pair(get_data().begin(), --get_data().end()), 2,
            spline_closed & 1);
        intp::InterpolationFunction1D<Vec<2, float>, float> vec_spline(
            intp::util::get_range(get_data()), 2, spline_closed & 2);

        auto& cp_origin = origin_vec_spline.spline().control_points();
        auto& cp = vec_spline.spline().control_points();
        for (std::size_t i = 0; i < cp.size(); ++i) {
            if (i < cp_origin.size()) {
                ptr[4 * i] = clip_x(cp_origin(i).x());
                ptr[4 * i + 1] = clip_y(cp_origin(i).y());
            }
            ptr[4 * i + 2] = clip_x(cp(i).x());
            ptr[4 * i + 3] = clip_y(cp(i).y());
        }
    } else {
        // point number too few for constructing a 2nd order spline
        for (std::size_t i = 0; i < get_data().size(); ++i) {
            ptr[4 * i] = clip_x(get_data()[i].x());
            ptr[4 * i + 1] = clip_y(get_data()[i].y());
        }
    }
    // update control point number
    glUniform1ui(control_point_size_loc, get_data().size());
    glUniform1i(periodic_loc, spline_closed);
    glUniform1i(visible_loc, spline_closed & 1 ? 1 : 3);
    glUniform1i(filled_loc, spline_filled);
    // update control points
    glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBufferSubData(GL_UNIFORM_BUFFER, 0,
                    static_cast<GLsizeiptr>(sizeof(float) * padded_data_size),
                    ptr.get());
    // TODO: No need to update the whole buffer.

    get_data().pop_back();

    // Draw the full-screen quad, to let OpenGL invoke fragment shader
    glBindVertexArray(vao);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

int main() {
    EmscriptenWebGLContextAttributes webgl_context_attr;
    emscripten_webgl_init_context_attributes(&webgl_context_attr);
    webgl_context_attr.majorVersion = 2;
    webgl_context_attr.minorVersion = 0;

#ifdef EXPLICIT_SWAP
    webgl_context_attr.explicitSwapControl = EM_TRUE;
    webgl_context_attr.renderViaOffscreenBackBuffer = EM_TRUE;
#endif

    exec_and_check(emscripten_set_canvas_element_size, canvas, canvas_width,
                   canvas_height);

    auto webgl_context =
        emscripten_webgl_create_context(canvas, &webgl_context_attr);

    exec_and_check(emscripten_webgl_make_context_current, webgl_context);
    std::cout << glGetString(GL_VERSION) << '\n';

    // Create shader program

    std::fstream fs("shader/vertex_shader.vert");
    if (!fs.is_open()) {
        std::cout << "Can not open vertex shader source file!\n";
        return 1;
    }
    std::string vertex_shader_source((std::istreambuf_iterator<char>(fs)),
                                     std::istreambuf_iterator<char>());
    fs.close();
    fs.clear();
    fs.open("shader/fragment_shader.frag");
    if (!fs.is_open()) {
        std::cout << "Can not open fragment shader source file!\n";
        return 1;
    }
    std::string fragment_shader_source((std::istreambuf_iterator<char>(fs)),
                                       std::istreambuf_iterator<char>());
    static ShaderProgram program(vertex_shader_source, fragment_shader_source);
    std::cout << "Shader compilation success.\n";
    program.use();

    // pass canvas dimension to shader as uniform
    glUniform2f(glGetUniformLocation(program, "canvas_size"),
                static_cast<GLfloat>(canvas_width),
                static_cast<GLfloat>(canvas_height));

    // line width
    glUniform1f(glGetUniformLocation(program, "width"), 0.008f);
    // dashing length
    glUniform1f(glGetUniformLocation(program, "dashing"), 0.06f);

    // interpolation

    // fill values into ubo, use std140 layout;
    constexpr unsigned MAX_ARRAY_SIZE = 1024;
    glGenBuffers(1, &ubo);
    glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBufferData(GL_UNIFORM_BUFFER, MAX_ARRAY_SIZE * sizeof(float) * 4, nullptr,
                 GL_STATIC_DRAW);

    const GLuint control_point_size = 0;
    control_point_size_loc =
        glGetUniformLocation(program, "control_point_size");
    glUniform1ui(control_point_size_loc, control_point_size);
    periodic_loc = glGetUniformLocation(program, "periodic");
    visible_loc = glGetUniformLocation(program, "visible");
    filled_loc = glGetUniformLocation(program, "filled");

    // bind ubo to shader program
    GLuint blockIndex = glGetUniformBlockIndex(program, "spline_data");
    GLuint bindingPoint = 0;
    glUniformBlockBinding(program, blockIndex, bindingPoint);
    glBindBufferBase(GL_UNIFORM_BUFFER, bindingPoint, ubo);

    // add blending
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    get_data().reserve(MAX_ARRAY_SIZE);

    auto handle_mouse_click = [](int, const EmscriptenMouseEvent* mouse_event,
                                 void*) {
        pt_type pt{mouse_event->targetX, mouse_event->targetY};
        switch (mouse_event->button) {
            case 0:  // left click
                if (spline_closed & 1) { break; }
                if (get_data().size() >= MAX_ARRAY_SIZE - 1) {
                    std::cout << "Point number reach maximum(" << MAX_ARRAY_SIZE
                              << ").\n";
                    break;
                }
                if (get_data().size() > 2 &&
                    (pt - get_data().front()).mag() < close_threshold) {
                    // close the spline
                    pt = get_data().front();
                    spline_closed |= 1;
                }
                get_data().emplace_back(std::move(pt));
                break;
            case 2:  // right click
                if (!get_data().empty()) { get_data().pop_back(); }
                spline_closed &= ~1;
                break;
        }
        return EM_TRUE;
    };
    auto handle_key = [](int, const EmscriptenKeyboardEvent* key_event, void*) {
        if (!get_data().empty() &&
            key_event->code == std::string{"Backspace"}) {
            get_data().pop_back();
            return EM_TRUE;
        }
        if (key_event->code == std::string{"KeyF"}) {
            spline_filled = 1 - spline_filled;
            return EM_TRUE;
        }
        return EM_FALSE;
    };
    auto handle_mouse_move = [](int, const EmscriptenMouseEvent* mouse_event,
                                void*) {
        current_pt = pt_type{mouse_event->targetX, mouse_event->targetY};
        return EM_TRUE;
    };
    emscripten_set_mousedown_callback(canvas, nullptr, false,
                                      handle_mouse_click);
    emscripten_set_keydown_callback("body", nullptr, false, handle_key);
    emscripten_set_mousemove_callback(canvas, nullptr, false,
                                      handle_mouse_move);

    emscripten_set_main_loop(draw, 0, EM_FALSE);

    // Prepare data for the full-screen quad
    {
        // x, y, r, g, b for point at upper-left, upper-right,
        // lower-right, lower-left.
        GLfloat positions_color[] = {
            -1.f, 1.f,  .9f, .7f, .4f, 1.f, 1.f,  .8f, .7f, 1.f,
            -1.f, -1.f, .5f, 1.f, .2f, 1.f, -1.f, .9f, .7f, .4f,
        };
        constexpr unsigned pos_size = 2;
        constexpr unsigned color_size = 3;
        constexpr unsigned vertex_size = pos_size + color_size;

        glGenVertexArrays(1, &vao);
        glBindVertexArray(vao);

        GLuint vbo;
        glGenBuffers(1, &vbo);
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(positions_color), positions_color,
                     GL_STATIC_DRAW);

        glEnableVertexAttribArray(0);
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(0, pos_size, GL_FLOAT, GL_FALSE,
                              sizeof(GLfloat) * vertex_size, nullptr);
        glVertexAttribPointer(
            1, color_size, GL_FLOAT, GL_FALSE, sizeof(GLfloat) * vertex_size,
            reinterpret_cast<void*>(sizeof(GLfloat) * pos_size));
    }

    std::cout << "\nClick left button to add new points;\n";
    std::cout << "Click right button or press backspace to delete points;\n";
    std::cout << "Press F to toggle spline filling;\n";
    std::cout << "Data (clicked) points, knots points (define segments) and "
                 "control points, respectively, are represented by the color "
                 "green, orange and red.\n";

#ifdef EXPLICIT_SWAP
    // commit frame after draw
    emscripten_webgl_commit_frame();
#endif
    return 0;
}
