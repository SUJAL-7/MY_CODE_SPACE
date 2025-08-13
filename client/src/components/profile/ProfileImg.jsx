import React from "react";

const ProfileImg = () => {
  return (
    <div className="h-[6vh] grid place-items-center p-1">
      <img
        src="/logo.jpeg"
        className="rounded-full overflow-hidden object-cover h-full aspect-square bg-green-800"
      />
    </div>
  );
};

export default ProfileImg;
