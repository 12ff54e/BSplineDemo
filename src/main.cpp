#include <emscripten/html5.h>
#include <webgl/webgl2.h>
#include <fstream>
#include <iostream>
#include <string>
#include "Shader.hpp"

#define canvas "#canvas"

#define exec_and_check(func, ...)                             \
    do {                                                      \
        if (func(__VA_ARGS__) != EMSCRIPTEN_RESULT_SUCCESS) { \
            std::cout << "Failed to invoke" #func << '\n';    \
            return 1;                                         \
        }                                                     \
    } while (false)

int main() {
    EmscriptenWebGLContextAttributes webgl_context_attr;
    emscripten_webgl_init_context_attributes(&webgl_context_attr);
    webgl_context_attr.majorVersion = 2;
    webgl_context_attr.minorVersion = 0;

#ifdef EXPLICIT_SWAP
    webgl_context_attr.explicitSwapControl = EM_TRUE;
    webgl_context_attr.renderViaOffscreenBackBuffer = EM_TRUE;
#endif

    int canvas_width = 800;
    int canvas_height = 600;
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
    ShaderProgram program(vertex_shader_source, fragment_shader_source);
    std::cout << "Shader compilation success.\n";
    program.use();

    // pass canvas dimension to shader as uniform
    auto canvas_size_uniform_loc = glGetUniformLocation(program, "canvas_size");
    glUniform2f(canvas_size_uniform_loc, static_cast<GLfloat>(canvas_width),
                static_cast<GLfloat>(canvas_height));

    // set background color to grey
    glClearColor(0.3f, 0.3f, 0.3f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT);

    // add blending
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    // Draw the full-screen quad
    {
        // x, y, r, g, b for point at upper-left, upper-right,
        // lower-right, lower-left.
        GLfloat positions_color[] = {
            -1.f, 1.f,  .9f, .7f, .4f, 1.f, 1.f,  1.f, .2f, .2f,
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
#ifdef EXPLICIT_SWAP
    // commit frame after draw
    emscripten_webgl_commit_frame();
#endif

    return 0;
}
