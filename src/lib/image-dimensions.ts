function readUInt16(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function getPngDimensions(buffer: Buffer) {
  if (buffer.length < 24) {
    return null;
  }
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSofMarker && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function getWebpDimensions(buffer: Buffer) {
  if (buffer.length < 16) {
    return null;
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function getTiffDimensions(buffer: Buffer) {
  if (buffer.length < 8) {
    return null;
  }

  const byteOrder = buffer.toString("ascii", 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return null;
  }

  const magic = readUInt16(buffer, 2, littleEndian);
  if (magic !== 42) {
    return null;
  }

  let ifdOffset = readUInt32(buffer, 4, littleEndian);
  const visited = new Set<number>();

  while (ifdOffset > 0 && ifdOffset + 2 <= buffer.length && !visited.has(ifdOffset)) {
    visited.add(ifdOffset);
    const entryCount = readUInt16(buffer, ifdOffset, littleEndian);
    let width: number | null = null;
    let height: number | null = null;

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (entryOffset + 12 > buffer.length) {
        return null;
      }

      const tag = readUInt16(buffer, entryOffset, littleEndian);
      const type = readUInt16(buffer, entryOffset + 2, littleEndian);
      const count = readUInt32(buffer, entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      const readValue = () => {
        if (type === 3 && count === 1) {
          return readUInt16(buffer, valueOffset, littleEndian);
        }
        if (type === 4 && count === 1) {
          return readUInt32(buffer, valueOffset, littleEndian);
        }
        return null;
      };

      if (tag === 256) {
        width = readValue();
      } else if (tag === 257) {
        height = readValue();
      }
    }

    if (width && height) {
      return { width, height };
    }

    const nextIfdOffsetPosition = ifdOffset + 2 + entryCount * 12;
    if (nextIfdOffsetPosition + 4 > buffer.length) {
      return null;
    }
    ifdOffset = readUInt32(buffer, nextIfdOffsetPosition, littleEndian);
  }

  return null;
}

export function getImageDimensions(buffer: Buffer, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType === "image/png") {
    return getPngDimensions(buffer);
  }
  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
    return getJpegDimensions(buffer);
  }
  if (normalizedMimeType === "image/webp") {
    return getWebpDimensions(buffer);
  }
  if (normalizedMimeType === "image/tiff" || normalizedMimeType === "image/tif") {
    return getTiffDimensions(buffer);
  }

  return null;
}
