/**
 * separate file for holding the raw string shaders. 
 * 
 * preferred convention: make the shader dict name correspond
 * to the id of the Shader that will process it.
 * 
 * preferred format should be: 
 *  export const my_shader = {
 *    "vertex_shader": "...",
 *    "fragment_shader": "..."
 *  }
 * 
 * the above formats and conventions are not really enforced, since
 * it's up to you how to grab from this file, but it would be 
 * super extra nice to make it the same way ;)
 */

// just a super basic phong shader
export const phong_basic = {
  // vertex shader
  "vertex_shader": `#version 300 es
      precision mediump float;
      
      in vec3 aPosition;
      in vec3 aNormal;
      in vec3 aColor;

      uniform mat4 uModelViewMatrix;
      uniform mat4 uProjectionMatrix;

      // allow for many matrices in a row
      uniform mat4 uModelTransformationMatrix;

      out vec3 vPosition;
      out vec3 vNormal;
      out vec3 vColor;

      void main() {
        // cast for transformations to a 4d homogenous coord
        vec4 pos = vec4(aPosition, 1.0);
        vec3 norm = aNormal;

        pos = uModelTransformationMatrix * pos; // add all transforms
        norm = transpose(inverse(mat3(uModelTransformationMatrix))) * norm; // ensure to also alter the norm

        // save the position of this vertex prior to projection -- send to frag.
        vec4 p = uModelViewMatrix * pos;
        vPosition = p.xyz;

        // use model view and apply to given normal -- send to frag.
        vNormal = transpose(inverse(mat3(uModelViewMatrix))) * norm;

        // set the actual positioning in the projection
        gl_Position = uProjectionMatrix * p;

        vColor = aColor; // send out the vertex color to frag shader
      }
    `,
    // fragment shader
    "fragment_shader": `#version 300 es
        precision mediump float;

        // struct to hold light parameters 
        struct MaterialParams {
          vec3 ka;
          vec3 kd;
          vec3 ks;
          float shininess;
          float transparency;
        };

        uniform MaterialParams uMaterialParams;

        in vec3 vPosition;
        in vec3 vNormal;
        in vec3 vColor;

        uniform vec3 uPointLights[50]; // points light positions in space
        uniform int uNumPointLights; // how many point lights

        out vec4 fragColor;

        void main() {
          vec3 N = normalize(vNormal); // ensure normalized
          vec3 V = normalize(-vPosition); // camera sits at the origin

          vec3 diffuse_acc = vec3(0.0);
          vec3 spec_acc = vec3(0.0);

          for (int i = 0; i < uNumPointLights; i++) {
            vec3 L = normalize(uPointLights[i] - vPosition); // get l as vector from this point
            vec3 R = reflect(-L, N); // r = 2(dot(n, l) * n - l) 
            float diff = max(dot(N, L), 0.0); // diffuse max
            float spec = pow(max(dot(V, R), 0.0), uMaterialParams.shininess); // specular max and power shininess
            diffuse_acc += (uMaterialParams.kd * vColor) * diff;
            spec_acc += (uMaterialParams.ks * vColor) * spec;
          } // end loop 

          fragColor = vec4(
            (uMaterialParams.ka * vColor) + 
            diffuse_acc + 
            spec_acc, 
            uMaterialParams.transparency
            );
        }
      `
} // end src

/**
 * this works with both TextureBumpMappingShader and TextureNormalMappingShader.
 */
export const texture_basic = {
  "vertex_shader": `#version 300 es
      in vec3 aPosition;
      in vec3 aNormal;
      in vec3 aColor;
      in vec3 aTangent;
      in vec2 aTexCoord;

      uniform mat4 uModelViewMatrix;
      uniform mat4 uProjectionMatrix;

      // allow for many matrices in a row
      uniform mat4 uModelTransformationMatrix;

      out vec3 vPosition;
      out vec3 vNormal;
      out vec3 vColor;
      out vec3 vTangent;
      out vec2 vTexCoord;

      void main() {
        // cast for transformations to a 4d homogenous coord
        vec4 pos = vec4(aPosition, 1.0);
        vec3 norm = aNormal;
        vec3 tangent = aTangent;

        // add transformations to all things that need it
        pos = uModelTransformationMatrix * pos; // add all transforms
        norm = transpose(inverse(mat3(uModelTransformationMatrix))) * norm; 
        tangent = transpose(inverse(mat3(uModelTransformationMatrix))) * tangent;

        // save the position of this vertex prior to projection -- send to frag.
        vec4 p = uModelViewMatrix * pos;
        vPosition = p.xyz;

        // use model view and apply to given normal -- send to frag.
        vNormal = transpose(inverse(mat3(uModelViewMatrix))) * norm; 
        vTangent = transpose(inverse(mat3(uModelViewMatrix))) * tangent;

        // set the actual positioning in the projection
        gl_Position = uProjectionMatrix * p;

        vColor = aColor; // send out the vertex color to frag shader
        vTexCoord = aTexCoord; // also send on out
      }
    `,
  "fragment_shader": `#version 300 es
      precision mediump float;

      // struct to hold material parameters 
      struct MaterialParams {
        vec3 ka;
        vec3 kd;
        vec3 ks;
        float shininess;
        float transparency;
      };

      uniform MaterialParams uMaterialParams;

      in vec3 vPosition;
      in vec3 vNormal;
      in vec3 vColor;
      in vec3 vTangent;
      in vec2 vTexCoord;

      uniform vec3 uPointLights[50]; // points light positions in space
      uniform int uNumPointLights; // how many point lights

      uniform sampler2D uTexture; // interface for the texture unit
      uniform int uMapping;  // 0 = bump mapping, 1 = normal mapping

      out vec4 fragColor;

      const float bumpScale = 15.0;

      // convert RGB to luminance (Rec._601 standard, https://en.wikipedia.org/wiki/Rec._601)
      // or you can use a height map texture
      float height(vec2 uv) {
        vec3 c = texture(uTexture, uv).rgb;
        return 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
      }

      void main() {

        vec3 N = normalize(vNormal); // ensure normalized
        vec3 V = normalize(-vPosition); // camera sits at the origin
        vec3 T = normalize(vTangent - dot(vTangent, N) * N);
        vec3 B = cross(N, T);
        mat3 TBN = mat3(T, B, N);

        vec3 baseColor;
        vec3 n;

        vec3 diffuse_acc = vec3(0.0);
        vec3 spec_acc = vec3(0.0);

        if (uMapping == 0) {
          // Bump mapping: tilt the normal against the gradient of the height field
          vec2 du = vec2(1.0 / float(textureSize(uTexture, 0).x), 0.0);
          vec2 dv = vec2(0.0, 1.0 / float(textureSize(uTexture, 0).y));
          float dhdu = (height(vTexCoord + du) - height(vTexCoord - du)) * 0.5;
          float dhdv = (height(vTexCoord + dv) - height(vTexCoord - dv)) * 0.5;
          n = normalize(vec3(-bumpScale * dhdu, -bumpScale * dhdv, 1.0));
          baseColor = texture(uTexture, vTexCoord).rgb;
        } else {
          // Normal mapping: the texture stores the tangent-space normal in [0, 1]
          n = normalize(texture(uTexture, vTexCoord).rgb * 2.0 - 1.0);
          baseColor = vColor;
        }

        N = normalize(TBN * n);

        for (int i = 0; i < uNumPointLights; i++) {
          vec3 L = normalize(uPointLights[i] - vPosition); // get l as vector from this point
          vec3 R = reflect(-L, N); // r = 2(dot(n, l) * n - l) 
          float diff = max(dot(N, L), 0.0); // diffuse max
          float spec = pow(max(dot(V, R), 0.0), uMaterialParams.shininess); // specular max and power shininess
          diffuse_acc += (uMaterialParams.kd * baseColor) * diff;
          spec_acc += (uMaterialParams.ks * baseColor) * spec;
        } // end loop 

        fragColor = vec4(
          (uMaterialParams.ka * baseColor) + 
          diffuse_acc + 
          spec_acc, 
          uMaterialParams.transparency
          );
      }`
} // end src

/**
 * this is imported from Liz's HW6 work, including all lighting
 * effects, along with texture mapping.
 */
export const planet_basic = {
  "vertex_shader": `#version 300 es
    in vec3 aPosition; 
    in vec3 aColor; 
    in vec3 aNormal; // surface normal in shapes 
    in vec3 aTangent;
    in vec2 aTextureCoor;
    
    uniform float uTime; //time in sec 
    uniform mat4 uModelViewMatrix; 
    uniform mat4 uProjectionMatrix; 
    uniform mat4 uModelTransformationMatrix; 
    uniform mat3 uNormalMatrix;
    
    out vec3 vColor;
    out vec3 vLensPosition;
    out vec3 vNormalLens;
    out vec3 vTangent;
    out vec2 vTextureCoor;
    
    void main() { 
        // position matrix of the view point
        vec4 posLens = uModelViewMatrix * uModelTransformationMatrix * vec4(aPosition,1.0); 
        vLensPosition = posLens.xyz; // drop the last val
        vNormalLens = normalize(uNormalMatrix * aNormal);

        
        vTangent = mat3(uModelViewMatrix * uModelTransformationMatrix) * aTangent;
        vTextureCoor = aTextureCoor;

        gl_Position = uProjectionMatrix * posLens; 
        vColor = aColor;
    }`,
  "fragment_shader": `#version 300 es 
    precision highp float; 
    
    in vec3 vColor; 
    in vec3 vLensPosition;
    in vec3 vNormalLens;
    in vec3 vTangent;
    in vec2 vTextureCoor;
    out vec4 fragColor; 

    struct Material {
        vec3 ka;             // ambient
        vec3 kd;             // diffuse
        vec3 ks;             // specular      
        float shininess;     // phong exp
        float metallic;      // 
        float emissive;      // 
    };

    uniform Material uMaterial;
    uniform bool uFlatShading;

    uniform sampler2D uTexture;
    uniform int uMapping; // numerical indicator from scene 

    const float bumbSize = 3.0;

    // brightnes & hieght relation
    float height(vec2 uv) {
        vec3 c = texture(uTexture, uv).rgb;
        return 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
    }

    // lights -- in view (lens) coordinates
    const int NUM_LIGHTS = 2;
    uniform vec4 uLightPos[NUM_LIGHTS];   // w = 1 point light, w = 0 parallel (direction toward light)
    uniform vec3 uLightColor[NUM_LIGHTS]; // I_L, color * intensity
    uniform vec3 uLightAtt[NUM_LIGHTS];   // (a, b, c) -> f_att = 1 / (a + b d + c d^2)
    uniform vec3 uAmbient;                // I_a

    // diffuse + specular for one light
    vec3 calculateLight(vec4 lightPos, vec3 lightColor, vec3 att,
                        vec3 normal, vec3 viewDir, vec3 base, vec3 specColor) {
        vec3 lightDir;   // l, toward the light
        float fAtt = 1.0;
        if (lightPos.w == 0.0) {
            lightDir = normalize(lightPos.xyz);                 // parallel light
        } else {
            vec3 toLight = lightPos.xyz - vLensPosition;        // point light
            float d = length(toLight);
            lightDir = toLight / d;
            fAtt = 1.0 / (att.x + att.y * d + att.z * d * d);  // attenuation
        }

        // diffuse: Kd * max(0, n . l)
        float cosTheta = max(dot(normal, lightDir), 0.0);
        vec3 diffuse = uMaterial.kd * cosTheta * base;

        // specular: Ks * max(0, v . r)^alpha,  r = 2(l . n)n - l
        vec3 specular = vec3(0.0);
        if (cosTheta > 0.0) {
            vec3 reflectDir = -reflect(lightDir, normal);
            float spec = pow(max(dot(viewDir, reflectDir), 0.0), uMaterial.shininess);
            specular = uMaterial.ks * spec * specColor;
        }

        return fAtt * lightColor * (diffuse + specular);
    }
    
    void main() { 
        // normal -- flat uses the triangle's face normal, smooth uses interpolated normal
        vec3 normal;
        if (uFlatShading) {
            normal = normalize(cross(dFdx(vLensPosition), dFdy(vLensPosition)));
        } else {
            normal = normalize(vNormalLens);
        }

        vec3 base = vColor;

        // texture mapping 
        if (uMapping == 3) {
            base = texture(uTexture, vTextureCoor).rgb;
        }

        // bump / normal mapping
        if (uMapping == 0 || uMapping == 1) {
            // tangent frame (T, B, N): T and B lie in the surface, N sticks out.
            // gram-schmidt makes T exactly perpendicular to N after interpolation.
            vec3 N = normal;
            vec3 T = normalize(vTangent - dot(vTangent, N) * N);
            vec3 B = cross(N, T);
            mat3 TBN = mat3(T, B, N);  

            vec3 n;  
            if (uMapping == 0) {

                // bump mapping
                vec2 texel = 1.0 / vec2(textureSize(uTexture, 0));
                vec2 du = vec2(texel.x, 0.0);
                vec2 dv = vec2(0.0, texel.y);
                float dhdu = (height(vTextureCoor + du) - height(vTextureCoor - du)) * 0.5;
                float dhdv = (height(vTextureCoor + dv) - height(vTextureCoor - dv)) * 0.5;
                n = normalize(vec3(-bumbSize * dhdu, -bumbSize * dhdv, 1.0));
                base = texture(uTexture, vTextureCoor).rgb;   
            } else {
                // normal mapping
                n = normalize(texture(uTexture, vTextureCoor).rgb * 2.0 - 1.0);
            }

            normal = normalize(TBN * n);
        }

        // ortho camera -> view direction is +z everywhere
        vec3 viewDir = vec3(0.0, 0.0, 1.0);

        vec3 specColor = mix(vec3(1.0), base, uMaterial.metallic);

        vec3 emissive = uMaterial.emissive * base;      // sun + orbits glow
        vec3 ambient = uMaterial.ka * uAmbient * base;  // I_a * Ka

        // I_final = I_a Ka + sum of each light
        vec3 result = emissive + ambient;
        for (int i = 0; i < NUM_LIGHTS; i++) {
            result += calculateLight(uLightPos[i], uLightColor[i], uLightAtt[i],
                                      normal, viewDir, base, specColor);
        }

        fragColor = vec4(result,1.0); 
    }`
} // end src



/**
 * TODO
 * need to have the transformation be single matrix
 * need to have the non-uniform scaling fix on all
 * need to put them together as dict pairs
 * need to right the shader for each.
 */
// FRAG --------------------------------------------------------------
// /**
//  * file to encap the either static grab or dynamic
//  * generation of vertex shaders for different nodes.
//  * 
//  * this is kept as a json -- will be fleshing out more later.
//  */

// /**
//  * most basic frag shader to use.
//  */
// const basic_frag_shader = {
//   "src": `#version 300 es
//     precision mediump float;
//     in vec3 vColor;

//     out vec4 fragColor;

//     void main() {
//       fragColor = vec4(vColor,1.0);
//     }
//   `
// }

// /**
//  * phong but with flat
//  * https://stackoverflow.com/questions/27581271/flat-qualifier-in-glsl
//  * https://wikis.khronos.org/opengl/Primitive#Provoking_vertex
//  * allow opengl to pick the vertex from the provoking vertex of the
//  * primitive (our case, 1st vertex of the triangle.)
//  */
// const flat_frag_shader = {
//   "src": `#version 300 es
//     precision mediump float;

//     // struct to hold light parameters 
//     struct MaterialParams {
//       vec3 ka;
//       vec3 kd;
//       vec3 ks;
//       float shininess;
//       float transparency;
//     };

//     uniform MaterialParams uMaterialParams;

//     in vec3 vPosition;
//     flat in vec3 vNormal;
//     in vec3 vColor;

//     uniform vec3 uPointLights[50]; // points light positions in space
//     uniform int uNumPointLights; // how many point lights

//     out vec4 fragColor;

//     void main() {
//       vec3 N = normalize(vNormal); // ensure normalized
//       vec3 V = normalize(-vPosition); // camera sits at the origin

//       vec3 diffuse_acc = vec3(0.0);
//       vec3 spec_acc = vec3(0.0);

//       for (int i = 0; i < uNumPointLights; i++) {
//         vec3 L = normalize(uPointLights[i] - vPosition); // get l as vector from this point
//         vec3 R = reflect(-L, N); // r = 2(dot(n, l) * n - l) 
//         float diff = max(dot(N, L), 0.0); // diffuse max
//         float spec = pow(max(dot(V, R), 0.0), uMaterialParams.shininess); // specular max and power shininess
//         diffuse_acc += (uMaterialParams.kd * vColor) * diff;
//         spec_acc += (uMaterialParams.ks * vColor) * spec;
//       } // end loop 

//       fragColor = vec4(
//         (uMaterialParams.ka * vColor) + 
//         diffuse_acc + 
//         spec_acc, 
//         uMaterialParams.transparency
//         );
//     }
//   `
// }

// /**
//  * basic frag shader, but named
//  * for clarity in use.
//  */
// const gouraud_frag_shader = {
//   "src": `#version 300 es
//     precision mediump float;

//     // struct to hold light parameters 
//     struct MaterialParams {
//       vec3 ka;
//       vec3 kd;
//       vec3 ks;
//       float shininess;
//       float transparency;
//     };

//     uniform MaterialParams uMaterialParams;
    
//     in vec3 vColor;

//     out vec4 fragColor;

//     void main() {
//       fragColor = vec4(vColor, uMaterialParams.transparency);
//     }
//   `
// }


// const texture_frag_shader = {
//   "src": 
// }

// VERT --------------------------------------------------------------
/**
 * file to encap the either static grab or dynamic
 * generation of vertex shaders for different nodes.
 * 
 * this is kept as a json--will be fleshing this idea out more later.
 */

/**
 * the most basic vertex shader, no lighting is considered.
 */
// const basic_vert_shader = {
//   // TODO
//   // "ins": ["aPosition", "aColor"],
//   // "uniforms": ["uProjectionMatrix", "uModelViewMatrix", "uModelTransformationMatrix"],
//   // "projection": "uProjectionMatrix", 
//   // "model_view": "uModelViewMatrix",
//   "src": `#version 300 es
//     in vec3 aPosition;
//     in vec3 aColor;

//     // uniform float uTime; //time in sec
//     uniform mat4 uModelViewMatrix;
//     uniform mat4 uProjectionMatrix;
    
//     // allow for many matrices in a row
//     uniform mat4 uModelTransformationMatrix[50];
//     uniform int transforms_up_to; // marker of how many transforms
    
//     out vec3 vColor; // color to interpolate

//     void main() {
//       // uProjectionMatrix * uModelViewMatrix * uModelTransformationMatrix * vec4(aPosition,1.0);
//       vec4 pos = vec4(aPosition, 1.0);
      

//       for (int i = 0; i < transforms_up_to; i++) {
//         pos = uModelTransformationMatrix[i] * pos; // add all transforms
//       } // end loop

//       gl_Position = uProjectionMatrix * uModelViewMatrix * pos;
//       // address some clipping while using an orthographic projection:
//       // https://stackoverflow.com/questions/66405678/othographic-projection-causing-geometry-to-get-clipped-by-the-far-plane
//       gl_Position.z *= 0.5;
      
//       vColor = aColor;
//     }
//   `
// }

// /**
//  * phong but with flat
//  * https://stackoverflow.com/questions/27581271/flat-qualifier-in-glsl
//  * https://wikis.khronos.org/opengl/Primitive#Provoking_vertex
//  * allow opengl to pick the vertex from the provoking vertex of the
//  * primitive (our case, 1st vertex of the triangle.)
//  */
// const flat_vert_shader = {
//    "src": `#version 300 es
//     precision mediump float;

//     // struct to hold light parameters 
//     struct MaterialParams {
//       vec3 ka;
//       vec3 kd;
//       vec3 ks;
//       float shininess;
//       float transparency;
//     };

//     uniform MaterialParams uMaterialParams;

//     in vec3 aPosition;
//     in vec3 aNormal;
//     in vec3 aColor;

//     uniform mat4 uModelViewMatrix;
//     uniform mat4 uProjectionMatrix;

//     // allow for many matrices in a row
//     uniform mat4 uModelTransformationMatrix[50];
//     uniform int transforms_up_to; // marker of how many transforms

//     out vec3 vPosition;
//     flat out vec3 vNormal;
//     out vec3 vColor;

//     void main() {
//       // cast for transformations to a 4d homogenous coord
//       vec4 pos = vec4(aPosition, 1.0);
//       vec3 norm = aNormal;

//       for (int i = 0; i < transforms_up_to; i++) {
//         pos = uModelTransformationMatrix[i] * pos; // add all transforms
//         norm = mat3(uModelTransformationMatrix[i]) * norm; // ensure to also alter the norm
//       } // end loop

//       // save the position of this vertex prior to projection -- send to frag.
//       vec4 p = uModelViewMatrix * pos;
//       vPosition = p.xyz;

//       // use model view and apply to given normal -- send to frag.
//       vNormal = mat3(uModelViewMatrix) * norm;

//       // set the actual positioning in the projection
//       gl_Position = uProjectionMatrix * p;

//       // address some clipping while using an orthographic projection:
//       // https://stackoverflow.com/questions/66405678/othographic-projection-causing-geometry-to-get-clipped-by-the-far-plane
//       //gl_Position.z *= 0.5;

//       vColor = aColor; // send out the vertex color to frag shader
//     }
//   `
// }

// /**
//  * a vertex shader that handles gouraud shading, which
//  * conducts the lighting calculations here, letting the
//  * colors found per vertex be interpolated instead of normals.
//  * should be used with: gouraud_frag_shader (or basic_frag_shader)
//  */
// const gouraud_vert_shader = {
//   "src": `#version 300 es
//     precision mediump float;

//     // struct to hold light parameters 
//     struct MaterialParams {
//       vec3 ka;
//       vec3 kd;
//       vec3 ks;
//       float shininess;
//       float transparency;
//     };

//     uniform MaterialParams uMaterialParams;

//     in vec3 aPosition;
//     in vec3 aNormal;
//     in vec3 aColor;

//     uniform mat4 uModelViewMatrix;
//     uniform mat4 uProjectionMatrix;

//     // allow for many matrices in a row
//     uniform mat4 uModelTransformationMatrix[50];
//     uniform int transforms_up_to; // marker of how many transforms

//     uniform vec3 uPointLights[50]; // points light positions in space
//     uniform int uNumPointLights; // how many point lights

//     out vec3 vColor; // only sends out color

//     void main() {
//       // cast for transformations to a 4d homogenous coord
//       vec4 pos = vec4(aPosition, 1.0);
//       vec3 norm = aNormal;

//       for (int i = 0; i < transforms_up_to; i++) {
//         pos = uModelTransformationMatrix[i] * pos; // add all transforms
//         norm = mat3(uModelTransformationMatrix[i]) * norm; // ensure to also alter the norm
//       } // end loop

//       // save the position of this vertex prior to projection
//       vec4 p = uModelViewMatrix * pos;
//       vec3 vPosition = p.xyz;

//       // use model view and apply to given normal 
//       vec3 vNormal = mat3(uModelViewMatrix) * norm;

//       vec3 N = normalize(vNormal); // ensure normalized
//       vec3 V = normalize(-vPosition); // camera sits at the origin

//       vec3 diffuse_acc = vec3(0.0);
//       vec3 spec_acc = vec3(0.0);

//       for (int i = 0; i < uNumPointLights; i++) {
//         vec3 L = normalize(uPointLights[i] - vPosition); // get l as vector from this point
//         vec3 R = reflect(-L, N); // r = 2(dot(n, l) * n - l) 
//         float diff = max(dot(N, L), 0.0); // diffuse max
//         float spec = pow(max(dot(V, R), 0.0), uMaterialParams.shininess); // specular max and power shininess
//         diffuse_acc += (uMaterialParams.kd * aColor) * diff;
//         spec_acc += (uMaterialParams.ks * aColor) * spec;
//       } // end loop 

//       vColor = vec3(
//         (uMaterialParams.ka * aColor) + 
//         diffuse_acc + 
//         spec_acc
//         );

//       // set the actual positioning in the projection
//       gl_Position = uProjectionMatrix * p;
//     }
//   `
// };


// const texture_vertex_shader = {
//   "src": 
// };

// ============================================================================
// TRANSITION PREVIEW: planet landing backdrop shaders (used by EarthScene).
// ============================================================================

/**
 * TRANSITION PREVIEW: full-screen sky gradient. The quad is already in clip space, so no
 * matrices are needed. Colour depends only on screen height: flat horizon colour below
 * uHorizonY, then a blend up to the zenith colour. uHaze > 1 keeps the horizon colour higher
 * (thick atmosphere), < 1 pushes the zenith colour down closer to the horizon.
 */
export const sky_gradient = {
  "vertex_shader": `#version 300 es
    in vec3 aPosition;
    out vec2 vNdc;
    void main() {
      vNdc = aPosition.xy;
      gl_Position = vec4(aPosition.xy, 0.0, 1.0);
    }`,
  "fragment_shader": `#version 300 es
    precision highp float;
    in vec2 vNdc;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform float uHorizonY; // clip-space height of the horizon line
    uniform float uHaze;
    out vec4 fragColor;
    void main() {
      float t = clamp((vNdc.y - uHorizonY) / (1.0 - uHorizonY), 0.0, 1.0);
      vec3 c = mix(uHorizon, uZenith, pow(t, uHaze));
      // tiny noise so the dark gradients do not band
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      fragColor = vec4(c, 1.0);
    }`
} // end src

/**
 * TRANSITION PREVIEW: big textured ground plane (or cloud deck) with distance fog.
 * Texture coordinates come from world x/z so the texture tiles across the plane.
 * The fog colour is the sky's horizon colour, so the plane melts into the sky at the horizon.
 */
export const ground_plane = {
  "vertex_shader": `#version 300 es
    in vec3 aPosition;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uModelTransformationMatrix;
    uniform vec2 uTile; // texture repeats per world unit (x, z)
    out vec2 vUV;
    out float vDepth;
    void main() {
      vec4 world = uModelTransformationMatrix * vec4(aPosition, 1.0);
      vec4 view = uModelViewMatrix * world;
      vUV = world.xz * uTile;
      vDepth = -view.z;
      gl_Position = uProjectionMatrix * view;
    }`,
  "fragment_shader": `#version 300 es
    precision highp float;
    in vec2 vUV;
    in float vDepth;
    uniform sampler2D uTexture;
    uniform vec3 uTint;
    uniform vec3 uFogColor;
    uniform vec2 uFogRange; // fog starts / is complete at these view depths
    out vec4 fragColor;
    void main() {
      // TRANSITION PREVIEW: planet textures are equirectangular, so their top and bottom rows are
      // polar caps / pinched poles. Fold v back and forth (triangle wave) and sample only the
      // middle 20%..80% of the texture so no cap stripe shows up where the tiles mirror.
      float tri = abs(mod(vUV.y, 2.0) - 1.0);
      vec2 uv = vec2(vUV.x, mix(0.2, 0.8, tri));
      vec3 base = texture(uTexture, uv).rgb * uTint;
      float fog = smoothstep(uFogRange.x, uFogRange.y, vDepth);
      fragColor = vec4(mix(base, uFogColor, fog), 1.0);
    }`
} // end src

/**
 * FPS PREVIEW: direction-based sky. Unlike sky_gradient (which only knows screen height), this one
 * rebuilds each pixel's WORLD view direction from the camera axes, so the horizon stays on the
 * horizon when the player looks up, down or around. Colour depends on the direction's height:
 * flat horizon colour at and below the horizon, blending to the zenith colour straight up.
 * uHaze > 1 keeps the horizon colour higher in the sky, < 1 pushes the zenith colour down.
 */
export const sky_dir = {
  "vertex_shader": `#version 300 es
    in vec3 aPosition;
    out vec2 vNdc;
    void main() {
      vNdc = aPosition.xy;
      gl_Position = vec4(aPosition.xy, 0.0, 1.0);
    }`,
  "fragment_shader": `#version 300 es
    precision highp float;
    in vec2 vNdc;
    uniform vec3 uRight;   // camera axes in world space
    uniform vec3 uUp;
    uniform vec3 uForward;
    uniform vec2 uTan;     // tan(fov / 2) * aspect, tan(fov / 2)
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform float uHaze;
    out vec4 fragColor;
    void main() {
      vec3 dir = normalize(uForward + uRight * (vNdc.x * uTan.x) + uUp * (vNdc.y * uTan.y));
      float t = pow(clamp(dir.y, 0.0, 1.0), 0.5); // sqrt: the gradient spends its range near the horizon
      vec3 c = mix(uHorizon, uZenith, pow(t, uHaze));
      // tiny noise so the dark gradients do not band
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      fragColor = vec4(c, 1.0);
    }`
} // end src
