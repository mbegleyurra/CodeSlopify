/**
 * file with both projection transformations for viewing
 * and object transformations.
 */

// The perspective matrix is built as a product of three factors:
//
//     M_per = M_orth * P * F
//
//   M_orth: Normalization from box to cube [l,r][b,t][n,f] -> [-1,1]^3
//   P: Perspective warping, from frustum to box
//   F: z-axis flip.


// Warpping the frustum into the box [l,r][b,t][n,f]
//   [ n  0   0    0  ]
//   [ 0  n   0    0  ]
//   [ 0  0  f+n  -fn ]
//   [ 0  0   1    0  ]
export function frustum2Box(near, far) {
    return new Float32Array([
        near, 0, 0, 0,
        0, near, 0, 0,
        0, 0, far + near, 1,
        0, 0, -far * near, 0
    ]);
}

// mapping box [l,r][b,t][n,f] onto the normalized cube [-1,1]^3.
//   [ 2/(r-l)    0        0      -(r+l)/(r-l) ]
//   [    0    2/(t-b)     0      -(t+b)/(t-b) ]
//   [    0       0     2/(f-n)   -(f+n)/(f-n) ]
//   [    0       0        0            1      ]
export function box2Cube(left, right, bottom, top, near, far) {
    const rl = 1 / (right - left), tb = 1 / (top - bottom), fn = 1 / (far - near);
    return new Float32Array([
        2 * rl, 0, 0, 0,
        0, 2 * tb, 0, 0,
        0, 0, 2 * fn, 0,
        -(right + left) * rl, -(top + bottom) * tb, -(far + near) * fn, 1
    ]);
}

//Camera Looks down -z, near/far passed as positive distances into the
//+z-forward convention P and M_orth are written in
export function flipZ() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
}


// Matrix multiplication
export function multiplyMat4(a, b) {
    let r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
            sum += a[k * 4 + i] * b[j * 4 + k]; 
        }
        r[j * 4 + i] = sum;
    }
    return r;
}

// Multiply matrices left to right, e.g. matMul(A, B, C) is A * B * C.
// JavaScript has no operator overloading, GLSL does overload `*` for mat4
export function matMul(...matrices) {
    return matrices.reduce(multiplyMat4);
}

// General perspective frustum
export function frustum(left, right, bottom, top, near, far) {
    const M_orth = box2Cube(left, right, bottom, top, near, far);
    const P      = frustum2Box(near, far);
    const F      = flipZ();
    return matMul(M_orth, P, F);        // M_per = M_orth * Perspective Warping * FlipZ
}

// Symmetric frustum from vertical field of view. fov in radians.
export function perspective(fov, aspect, near, far) {
    const top = near * Math.tan(fov / 2);
    const right = top * aspect;
    return frustum(-right, right, -top, top, near, far);
}

// Orthographic matrix
// export function ortho(left, right, bottom, top, near, far) {
//     const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far);
//     return new Float32Array([
//         -2*lr, 0, 0, 0,
//         0, -2*bt, 0, 0,
//         0, 0, 2*nf, 0,
//         (left+right)*lr, (top+bottom)*bt, (far+near)*nf, 1
//     ]);
// }
export function ortho(orthoSize, aspect, zNear, zFar) { // the same as above pretty much, but moving this here.
  return matMul(
      box2Cube(-orthoSize * aspect, orthoSize * aspect, -orthoSize, orthoSize, zNear, zFar),
      flipZ()
    )
}

// Identity matrix
export function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// Matrix translation
export function mat4Translate(matrix, translation) {
    const result = new Float32Array(matrix);
    result[12] = matrix[0] * translation[0] + matrix[4] * translation[1] + matrix[8] * translation[2] + matrix[12];
    result[13] = matrix[1] * translation[0] + matrix[5] * translation[1] + matrix[9] * translation[2] + matrix[13];
    result[14] = matrix[2] * translation[0] + matrix[6] * translation[1] + matrix[10] * translation[2] + matrix[14];
    result[15] = matrix[3] * translation[0] + matrix[7] * translation[1] + matrix[11] * translation[2] + matrix[15];
    return result;
}

// Matrix rotation around X axis
export function mat4RotateX(matrix, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const result = new Float32Array(matrix);

    const mv1 = matrix[4], mv5 = matrix[5], mv9 = matrix[6], mv13 = matrix[7];
    const mv2 = matrix[8], mv6 = matrix[9], mv10 = matrix[10], mv14 = matrix[11];

    result[4] = mv1 * c + mv2 * s;
    result[5] = mv5 * c + mv6 * s;
    result[6] = mv9 * c + mv10 * s;
    result[7] = mv13 * c + mv14 * s;
    result[8] = mv2 * c - mv1 * s;
    result[9] = mv6 * c - mv5 * s;
    result[10] = mv10 * c - mv9 * s;
    result[11] = mv14 * c - mv13 * s;

    return result;
}

// Matrix rotation around Y axis
export function mat4RotateY(matrix, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const result = new Float32Array(matrix);

    const mv0 = matrix[0], mv4 = matrix[1], mv8 = matrix[2], mv12 = matrix[3];
    const mv2 = matrix[8], mv6 = matrix[9], mv10 = matrix[10], mv14 = matrix[11];

    result[0] = mv0 * c - mv2 * s;
    result[1] = mv4 * c - mv6 * s;
    result[2] = mv8 * c - mv10 * s;
    result[3] = mv12 * c - mv14 * s;
    result[8] = mv0 * s + mv2 * c;
    result[9] = mv4 * s + mv6 * c;
    result[10] = mv8 * s + mv10 * c;
    result[11] = mv12 * s + mv14 * c;

    return result;
}


// [optional] Helper export function converting math format row-major matrices into a flat column-major array.
export function mat4FromRows(m00, m01, m02, m03,
                      m10, m11, m12, m13,
                      m20, m21, m22, m23,
                      m30, m31, m32, m33) {
    return new Float32Array([
        m00, m10, m20, m30,   // column 0
        m01, m11, m21, m31,   // column 1
        m02, m12, m22, m32,   // column 2
        m03, m13, m23, m33    // column 3
    ]);
}

/**
 * helper -> degree to radian as needed
 */
export function deg_to_rad(degrees) {
    return degrees * (Math.PI / 180.0);
} // end method


// drop translations
function mat3FromMat4(matrix){
    return new Float32Array([matrix[0], matrix[1], matrix[2],
                             matrix[4], matrix[5], matrix[6],
                             matrix[8], matrix[9], matrix[10],]);
}

// 3x3 transpose
function mat3Transpose(matrix){
    return new Float32Array([matrix[0], matrix[3], matrix[6],
                             matrix[1], matrix[4], matrix[7],
                             matrix[2], matrix[5], matrix[8],]);
}

// 3x3 inverse 
function mat3Inverse(matrix){
    // make variables
    const a = matrix[0], b = matrix[1], c = matrix[2];
    const d = matrix[3], e = matrix[4], f = matrix[5];
    const g = matrix[6], h = matrix[7], i = matrix[8];

    // minors
    const A = (e*i - f*h), B = (d*i - f*g), C = (d*h - e*g);
    const D = (b*i - c*h), E = (a*i - c*g), F = (a*h - b*g);
    const G = (b*f - c*e), H = (a*f - c*d), I = (a*e - b*d);

    const det = a * A- b * B + c * C;

    return new Float32Array([A/det, -D/det, G/det,
                             -B/det, E/det, -H/det,
                             C/det, -F/det, I/det,]);

}

// M_S = (M^(-1))^T
export function normalMat(modelView){
    return mat3Transpose(mat3Inverse(mat3FromMat4(modelView)));
} // end function


/**
 * ========================================================
 * TRANSFORMATIONS OF OBJECT
 * ========================================================
 */

/**
 * translation by tx, ty, tz.
 * translations   -> should be a 3d list where [tx, ty, tz]
 * returns a float 32 array.
 */
export function translate(translations) {
    const tx = translations[0]
    const ty = translations[1]
    const tz = translations[2]

    const trans = mat4FromRows(
        1.0, 0.0, 0.0, tx,
        0.0, 1.0, 0.0, ty,
        0.0, 0.0, 1.0, tz,
        0.0, 0.0, 0.0, 1.0
    )

    return trans
} // end method

/**
 * scaling of an object by a given value
 * factor -> should be a 3d list where [sx, sy, sz]
 */
export function scale(factor) {
    // catch the mistake of scaling by 0!
    const sx = factor[0] == 0 ? 1 : factor[0]
    const sy = factor[1] == 0 ? 1 : factor[1]
    const sz = factor[2] == 0 ? 1 : factor[2]

    const sc = mat4FromRows(
        sx, 0.0, 0.0, 0.0, 
        0.0, sy, 0.0, 0.0,
        0.0, 0.0, sz, 0.0,
        0.0, 0.0, 0.0, 1.0
    )

    return sc
} // end method

/**
 * rotation of object by radians. can trigger clockwise.
 * returns the float32 needed for that rotation.
 * radians   -> should be a 3d list where [rx, ry, rz]
 * clockwise -> bool, true/false
 */
export function rotate(radians) {
    let rot // rotation matrix
    const rx = radians[0]
    const ry = radians[1]
    const rz = radians[2]

    const cosx = Math.cos(rx)
    const cosy = Math.cos(ry)
    const cosz = Math.cos(rz)

    const sinx = Math.sin(rx)
    const siny = Math.sin(ry)
    const sinz = Math.sin(rz)

    // set as rotation matrix
    rot = mat4FromRows(
        cosz * cosy, (cosz * siny * sinx) - (sinz * cosx), (cosz * siny * cosx) + (sinz * sinx), 0.0,
        sinz * cosy, (sinz * siny * sinx) + (cosz * cosx), (sinz * siny * cosx) - (cosz * sinx), 0.0,
        -siny      , cosy * sinx                         , cosy * cosx                         , 0.0,
        0.0        , 0.0                                 , 0.0                                 , 1.0            
    )

    return rot // return the matrix
} // end method

/**
 * export function to reflect the object.
 * here, we will just take in a degree value
 * and have helpers for specific axis reflections.
 * radians -> radians to reflect by, scalar
 */
export function reflect(radians) {
    const two_theta = 2 * radians
    const sin = Math.sin(two_theta)
    const cos = Math.cos(two_theta)

    const refl = mat4FromRows(
        cos,  sin, 0.0, 0.0,
        sin, -cos, 0.0, 0.0,
        0.0,  0.0, 1.0, 0.0,
        0.0,  0.0, 0.0, 1.0,
    )

    return refl
} // end method

/**
 * reflect object over the x axis
 */
export function reflect_x() {
    return reflect(deg_to_rad(0))
} // end method

/**
 * reflect object over the y axis
 */
export function reflect_y() {
    return reflect(deg_to_rad(90))
} // end method

/**
 * reflect object over the y = x axis
 */
export function reflect_xy() {
    return reflect(deg_to_rad(45))
} // end method

/**
 * shearing/skewing export function
 * factor -> should be 3d list where [shx, shy, shz]
 */
export function shear(factor) {
    const shx = factor[0]
    const shy = factor[1]
    const shz = factor[2]

    const sh = mat4FromRows(
        1.0,  shx, shx, 0.0,
        shy,  1.0, shy, 0.0,
        shz,  shz, 1.0, 0.0,
        0.0,  0.0, 0.0, 1.0,
    )

    return sh
} // end method


/**
 * ========================================================
 * TRANSITION PREVIEW: camera view helpers
 * ========================================================
 */

// TRANSITION PREVIEW: standard lookAt view matrix (column-major, like everything else here).
// eye/target/up are plain [x, y, z] arrays. The camera looks down its own -z axis,
// so with eye = [0,0,0] and target = [0,0,-1] this is exactly the identity matrix.
export function lookAt(eye, target, up=[0, 1, 0]) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

    const f = norm(sub(target, eye)); // forward
    const s = norm(cross(f, up));     // right
    const u = cross(s, f);            // true up

    // rows: right, up, -forward, then the translation that moves the eye to the origin.
    return mat4FromRows(
         s[0],  s[1],  s[2], -dot(s, eye),
         u[0],  u[1],  u[2], -dot(u, eye),
        -f[0], -f[1], -f[2],  dot(f, eye),
         0.0,   0.0,   0.0,   1.0
    );
} // end function

// TRANSITION PREVIEW: apply a mat4 to a point [x, y, z] (w = 1), returns [x, y, z].
export function transform_point(matrix, p) {
    return [
        matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12],
        matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13],
        matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14]
    ];
} // end function
