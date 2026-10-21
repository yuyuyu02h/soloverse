# X Clone - Responsive Frontend Project

## Overview
This project is a responsive clone of the X (formerly Twitter) platform, developed as part of my ITI (Information Technology Institute) frontend track. The project focuses on implementing responsive design concepts using **Bootstrap** and includes two main pages: a **landing page** and a **feed page**. It was one of the **top 10 projects** in my cohort.

The project demonstrates my understanding of:
- **HTML5** for structuring the content.
- **CSS3** for styling and responsiveness.
- **Bootstrap 5** for layout, components, and utilities.
- **JavaScript** for form validation and dynamic content rendering.
- **API integration** to fetch and display data dynamically.

---

## Features

### Landing Page
- **Responsive Design**: Adapts to different screen sizes (desktop, tablet, mobile).
- **Sign-In/Sign-Up Modals**: Includes modals for user authentication with form validation.
- **Social Login Options**: Buttons for signing up with Google or Apple.
- **Footer Links**: Links to various X platform policies and resources.

### Feed Page
- **Responsive Layout**: Features a left sidebar, main content area, and right sidebar (hidden on smaller screens).
- **Bottom Navigation Bar**: Mobile-friendly navigation bar for smaller screens.
- **Dynamic Posts**: Fetches and displays posts from an external API (The Movie Database API).
- **Trending Section**: Displays trending topics with mock data.

---

## Technologies Used
- **HTML5**: For structuring the web pages.
- **CSS3**: For custom styling and responsiveness.
- **Bootstrap 5**: For responsive layout, components, and utilities.
- **JavaScript**: For form validation and dynamic content rendering.
- **The Movie Database API**: For fetching and displaying posts dynamically.

---

## Project Structure

### Files
1. **`index.html`**: The landing page with sign-in and sign-up modals.
2. **`feed.html`**: The feed page with dynamic posts and trending section.
3. **`styles.css`**: Custom CSS for styling the project.
4. **`javascript.js`**: JavaScript for form validation, API integration, and dynamic content rendering.

### Folder Structure
```
/x-clone/
├── index.html
├── feed.html
├── css/
│   └── styles.css
├── java script/
│   └── javascript.js
├── bootstrap-5.3.3-dist/
│   └── (Bootstrap files)
├── resources/
│   └── person.png
```

---

## How to Run the Project
1. Clone the repository or download the project files.
2. Open the `index.html` file in your browser to view the landing page.
3. Open the `feed.html` file to view the feed page with dynamic posts.

---

## Key Code Snippets

### Landing Page (Sign-In Modal)
```html
<div class="modal" data-bs-backdrop="static" data-bs-keyboard="false" id="signInModal">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content bg-black text-white">
      <div class="position-relative mb-5">
        <button class="btn" data-bs-dismiss="modal">
          <i class="bi bi-x fs-4"></i>
        </button>
        <i class="bi bi-twitter-x fs-3 position-absolute start-50 translate-middle-x mt-3"></i>
      </div>
      <div class="container mb-5">
        <h3>Enter your email and password</h3>
        <form id="signInForm" class="d-flex flex-column mt-5 align-items-center">
          <input type="text" class="w-100 rounded mb-2 form-control" id="emailId" placeholder="Email">
          <p id="emailErrorId" class="e-none error">Please enter a valid email address.</p>
          <input type="text" class="w-100 rounded mb-2 form-control" id="passwordId" placeholder="Password">
          <p id="passwordErrorId" class="p-none error">Please enter a strong password.</p>
        </form>
      </div>
      <div class="d-flex flex-column align-items-center">
        <button onclick="submitForm()" class="btn btn-light w-100 fw-bold rounded-pill">
          Log in
        </button>
      </div>
    </div>
  </div>
</div>
```

### Feed Page (Dynamic Posts)
```javascript
function GetData() {
  var xhr = new XMLHttpRequest();
  var token = 'Bearer YOUR_API_TOKEN';
  var url = `https://api.themoviedb.org/3/trending/all/day?language=en-US`;

  xhr.open("GET", url);
  xhr.setRequestHeader("Authorization", token);
  xhr.onload = function () {
    if (xhr.status === 200) {
      var response = JSON.parse(xhr.responseText);
      apiData = response.results.map(item => ({
        overview: item.overview,
      }));
      displayPosts();
    }
  };
  xhr.send();
}

function displayPosts() {
  apiData.forEach((card) => {
    container.innerHTML += `<div class="row mx-1 mt-2 border rounded">
      <div class="col-2 mt-3">
        <img class="rounded-circle" src="/resources/person.png" height="50px">
      </div>
      <div class="col-10">
        <div class="row ps-1 pt-2">
          <div class="col-11">
            <p><span class="fw-bold">Yousef Khalaf </span>@yk369 . 18h</p>
          </div>
          <div class="col-1 ps-0">
            <i class="btn bi bi-three-dots"></i>
          </div>
        </div>
        <div class="col">
          ${card.overview}
          <br>
          <div class="row my-3">
            <div class="col"><i class="postIcon bi bi-chat-fill"></i></div>
            <div class="col"><i class="postIcon bi bi-reply-fill"></i></div>
            <div class="col"><i class="postIcon bi bi-heart-fill"></i></div>
            <div class="col"><i class="postIcon bi bi-share-fill"></i></div>
          </div>
        </div>
      </div>
    </div>`;
  });
}
```

---

## Challenges Faced
1. **Responsive Design**: Ensuring the layout adapts seamlessly to different screen sizes.
2. **Form Validation**: Implementing real-time validation for email, password, and username fields.
3. **API Integration**: Fetching and displaying data dynamically from an external API.

---

## Future Improvements
- Add user authentication functionality.
- Implement a backend to store user data and posts.
- Enhance the UI/UX with animations and transitions.
- Add more interactive features like liking, sharing, and commenting on posts.

---

## Screenshots
Landing Page: ![image](https://github.com/user-attachments/assets/95f59563-4cfa-445e-8aed-c2f01e00c474) ![image](https://github.com/user-attachments/assets/0484f7ad-57bb-4fd5-ad82-31ca08574c27)
 ![image](https://github.com/user-attachments/assets/ce06f2fb-dd1c-421d-8cfc-e433f6b1ad59)

Feed Page: ![image](https://github.com/user-attachments/assets/8dd2e846-5a58-4170-bffd-75c346a55701) ![image](https://github.com/user-attachments/assets/3a3619c6-a347-4e49-ae03-6442e7f1e7fb) ![image](https://github.com/user-attachments/assets/dcc81f22-5f58-40c6-a9c6-1aa7dedaf434)

---

## License
This project is open-source and available under the MIT License.

---

## Acknowledgments
- **Bootstrap** for providing a robust framework for responsive design.
- **The Movie Database API** for providing data for dynamic posts.
- **ITI** for providing the platform and resources to learn and grow.
