/* Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ===========================================================================*/

#ifndef KERNELS_PRELU_H_
#define KERNELS_PRELU_H_

namespace tfjs {

namespace wasm {
extern "C" {
void prelu(int x_id, int x_size, int weights_id, int out_id);
}

}  // namespace wasm
}  // namespace tfjs

#endif  // KERNELS_PRELU_H_
