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

// vertex array buffer
static GLuint vao;
// uniform buffer id
static GLuint ubo;

// Parameters send to main loop callback function are encapsulated in this
// struct, they are all reference to static objects.
struct main_loop_args {
    ShaderProgram& program_ref;
    std::vector<pt_type>& data_ref;
    pt_type& current_pt_ref;
};

#define exec_and_check(func, ...)                             \
    do {                                                      \
        if (func(__VA_ARGS__) != EMSCRIPTEN_RESULT_SUCCESS) { \
            std::cout << "Failed to invoke" #func << '\n';    \
            return 1;                                         \
        }                                                     \
    } while (false)

// main loop
static void draw(void* args_ptr) {
    // unpack args
    auto args = *static_cast<main_loop_args*>(args_ptr);
    auto& program = args.program_ref;
    auto& data = args.data_ref;
    auto& current_pt = args.current_pt_ref;

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
        return 1.f - static_cast<float>(y) / static_cast<float>(canvas_height);
    };

    // update uniform buffer
    data.push_back(current_pt);
    // TODO: Draw a separate spline containing current point

    // pad every point to a vec4
    std::size_t padded_data_size = data.size() * 4;
    std::unique_ptr<float[]> ptr(new float[padded_data_size]{});
    if (data.size() >= 3) {
        intp::InterpolationFunction1D<pt_type, coord_type> origin_vec_spline(
            std::make_pair(data.begin(), --data.end()), 2);
        intp::InterpolationFunction1D<Vec<2, float>, float> vec_spline(
            intp::util::get_range(data), 2);

        for (std::size_t i = 0; i < data.size(); ++i) {
            auto& cp_origin = origin_vec_spline.spline().control_points()(i);
            auto& cp = vec_spline.spline().control_points()(i);
            if (i < data.size() - 1) {
                ptr[4 * i] = clip_x(cp_origin.x());
                ptr[4 * i + 1] = clip_y(cp_origin.y());
            }
            ptr[4 * i + 2] = clip_x(cp.x());
            ptr[4 * i + 3] = clip_y(cp.y());
        }
    } else {
        // point number too few for constructing a 2nd order spline
        for (std::size_t i = 0; i < data.size(); ++i) {
            ptr[4 * i] = clip_x(data[i].x());
            ptr[4 * i + 1] = clip_y(data[i].y());
        }
    }
    // update control point number
    glUniform1ui(glGetUniformLocation(program, "control_point_size"),
                 data.size());
    // update control points
    glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBufferSubData(GL_UNIFORM_BUFFER, 0,
                    static_cast<GLsizeiptr>(sizeof(float) * padded_data_size),
                    ptr.get());
    // TODO: No need to update the whole buffer.

    data.pop_back();

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
    glUniform1ui(glGetUniformLocation(program, "control_point_size"),
                 control_point_size);

    // bind ubo to shader program
    GLuint blockIndex = glGetUniformBlockIndex(program, "spline_data");
    GLuint bindingPoint = 0;
    glUniformBlockBinding(program, blockIndex, bindingPoint);
    glBindBufferBase(GL_UNIFORM_BUFFER, bindingPoint, ubo);

    // add blending
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    static std::vector<pt_type> data;
    data.reserve(MAX_ARRAY_SIZE);
    static pt_type current_pt;

    static main_loop_args args{program, data, current_pt};

    auto handle_mouse_click = [](int, const EmscriptenMouseEvent* mouse_event,
                                 void* user_data) {
        auto& vec = *static_cast<std::vector<pt_type>*>(user_data);
        switch (mouse_event->button) {
            case 0:
                if (vec.size() < MAX_ARRAY_SIZE) {
                    vec.emplace_back(mouse_event->targetX,
                                     mouse_event->targetY);
                } else {
                    std::cout << "Point number reach maximum(" << MAX_ARRAY_SIZE
                              << ").\n";
                }
                break;
            case 2:
                if (!vec.empty()) { vec.pop_back(); }
                break;
        }
        return EM_TRUE;
    };
    auto handle_key = [](int, const EmscriptenKeyboardEvent* key_event,
                         void* user_data) {
        auto& vec = *static_cast<std::vector<pt_type>*>(user_data);
        if (!vec.empty() && key_event->code == std::string{"Backspace"}) {
            vec.pop_back();
        }
        return EM_TRUE;
    };
    auto handle_mouse_move = [](int, const EmscriptenMouseEvent* mouse_event,
                                void* user_data) {
        *static_cast<pt_type*>(user_data) =
            pt_type{mouse_event->targetX, mouse_event->targetY};
        return EM_TRUE;
    };
    emscripten_set_mousedown_callback(canvas, static_cast<void*>(&data), false,
                                      handle_mouse_click);
    emscripten_set_keyup_callback(canvas, static_cast<void*>(&data), false,
                                  handle_key);
    emscripten_set_mousemove_callback(canvas, static_cast<void*>(&current_pt),
                                      false, handle_mouse_move);

    emscripten_set_main_loop_arg(draw, static_cast<void*>(&args), 0, EM_FALSE);

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

    std::cout << "\nLeft click to add new points;\n";
    std::cout << "Right click / Backspace to remove a point;\n";
    std::cout
        << "Green, orange and red points are data (clicked) points, knots "
           "points (define segments) and control points respectively.\n";

#ifdef EXPLICIT_SWAP
    // commit frame after draw
    emscripten_webgl_commit_frame();
#endif
    return 0;
}
