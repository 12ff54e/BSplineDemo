#include <emscripten/html5.h>
#include <webgl/webgl2.h>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include "Interpolation.hpp"
#include "Shader.hpp"
#include "Vec.hpp"

#define canvas "#canvas"
using pt_type = Vec<2, float>;

constexpr int canvas_width = 800;
constexpr int canvas_height = 600;

// uniform buffer id
static GLuint ubo;

#define exec_and_check(func, ...)                             \
    do {                                                      \
        if (func(__VA_ARGS__) != EMSCRIPTEN_RESULT_SUCCESS) { \
            std::cout << "Failed to invoke" #func << '\n';    \
            return 1;                                         \
        }                                                     \
    } while (false)

static void draw(ShaderProgram& program, std::vector<pt_type>& data) {
    // set background color to grey
    glClearColor(0.3f, 0.3f, 0.3f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT);

    glUniform1ui(glGetUniformLocation(program, "control_point_size"),
                 data.size());

    constexpr float ar =
        static_cast<float>(canvas_width) / static_cast<float>(canvas_height);
    auto clip_x = [](float x) {
        return x / static_cast<float>(canvas_height) - .5f * ar;
    };
    auto clip_y = [](float y) {
        return 1.f - y / static_cast<float>(canvas_height);
    };

    std::size_t padded_data_size = data.size() * 4;
    std::unique_ptr<float[]> ptr(new float[padded_data_size]);
    if (data.size() >= 2) {
        // interpolation
        // intp::InterpolationFunctionTemplate1D<float> intp_temp(data.size(),
        // 2); std::vector<float> x_coord, y_coord;
        // x_coord.reserve(data.size());
        // y_coord.reserve(data.size());
        // for (auto& vec : data) {
        //     x_coord.push_back(vec.x());
        //     y_coord.push_back(vec.y());
        // }
        // auto x_spline =
        // intp_temp.interpolate(intp::util::get_range(x_coord)); auto y_spline
        // = intp_temp.interpolate(intp::util::get_range(y_coord));

        intp::InterpolationFunction1D<Vec<2, float>, float> vec_spline(
            intp::util::get_range(data), 2);

        for (std::size_t i = 0; i < data.size(); ++i) {
            auto& cp = vec_spline.spline().control_points()(i);
            ptr[4 * i] = clip_x(cp.x());
            ptr[4 * i + 1] = clip_y(cp.y());
        }
    } else {
        // point number too few for constructing a 2nd order spline
        for (std::size_t i = 0; i < data.size(); ++i) {
            ptr[4 * i] = clip_x(data[i].x());
            ptr[4 * i + 1] = clip_y(data[i].y());
        }
    }
    // update control points
    glBindBuffer(GL_UNIFORM_BUFFER, ubo);
    glBufferSubData(GL_UNIFORM_BUFFER, 0,
                    static_cast<GLsizeiptr>(sizeof(float) * padded_data_size),
                    ptr.get());

    // Draw the full-screen quad, to let OpenGL invoke fragment shader
    {
        // x, y, r, g, b for point at upper-left, upper-right,
        // lower-right, lower-left.
        GLfloat positions_color[] = {
            -1.f, 1.f,  .9f, .7f, .4f, 1.f, 1.f,  .8f, .7f, 1.f,
            -1.f, -1.f, .5f, 1.f, .2f, 1.f, -1.f, .9f, .7f, .4f,
        };
        constexpr unsigned pos_size = 2;
        constexpr unsigned color_size = 3;
        constexpr unsigned int vertex_size = pos_size + color_size;
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

        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
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

    draw(program, data);

    auto add_point = [](int, const EmscriptenMouseEvent* mouse_event,
                        void* user_data) {
        auto& vec = *static_cast<std::vector<pt_type>*>(user_data);
        if (vec.size() < MAX_ARRAY_SIZE) {
            vec.emplace_back(mouse_event->targetX, mouse_event->targetY);
        } else {
            std::cout << "Point number reach maximum(" << MAX_ARRAY_SIZE
                      << ").\n";
        }
        draw(program, vec);
        return EM_TRUE;
    };
    auto remove_point = [](int, const EmscriptenKeyboardEvent* key_event,
                           void* user_data) {
        auto& vec = *static_cast<std::vector<pt_type>*>(user_data);
        if (!vec.empty() && key_event->code == std::string{"Backspace"}) {
            vec.pop_back();
        }
        draw(program, vec);
        return EM_TRUE;
    };
    emscripten_set_click_callback(canvas, static_cast<void*>(&data), false,
                                  add_point);
    emscripten_set_keyup_callback(canvas, static_cast<void*>(&data), false,
                                  remove_point);

#ifdef EXPLICIT_SWAP
    // commit frame after draw
    emscripten_webgl_commit_frame();
#endif
    return 0;
}
