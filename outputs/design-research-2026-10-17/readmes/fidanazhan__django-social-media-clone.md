# Social Media Clone (QuackQuack App)
This project is an imitation of a social media website made with Django for backend and basic HTML, CSS, Javascript for the frontend. The UI/UX design are made with figma and all the design are code using pure CSS

## TABLE OF CONTENTS
  
  -  [Overview](#overview)
  -  [Technology](#technology)
  -  [Requirement](#requirement)
  -  [URL References](#url-notes-and-references)
  -  [Screenshot](#screenshot)
  -  [Status](#status)
  -  [What Is Next?](#what-is-next) 
  -  [Contact](#contact)

## **OVERVIEW**

QuackQuack app is an imitation of social media apps like Twitter and Facebook where users can post their activities, comment on other posts, reply to a comment, search users and many more. People can follow other users and the index page of the user will be posts of their followings. Comments of their following will also display in the index page. Currently, there are only four reactions to the post implemented in this app which are likes, shares, comments and bookmark. 

## **TECHNOLOGY** 

- Framework/Stack : Django, HTML, CSS, Javascript, ORM
- Database : SQLite / PostgreSQL
- System Architecture : Monolithic
- Software Architecture : MVT / MVC

## **REQUIREMENT**

- Users need to register and login before using this app. (Authentication) 
- Users can write posts, comment and reply to comments.
- Users can search other users.
- Users can like, share, comment and bookmark posts or comments.
- They will be notified when other users follow them, comment on their post, like their post and share their post.
- Only the user can edit and delete their specific post and comment.
- Users can search other users or post.
- Users can see the list of notifications and bookmark in notification page and bookmark page.

## URL NOTES AND REFERENCES

![URL Notes   References](https://user-images.githubusercontent.com/108860416/192300701-2f38eb7f-c7eb-4c9a-911c-18263700521c.PNG)

&nbsp;

Here is references for QuackQuack Apps url.
- [Notion](https://www.notion.so/3de9978e63ed4ca4ba380292635ae806?v=55abb802e4fc45fa80f6a59a4b012999) 
- [Google Sheet](https://docs.google.com/spreadsheets/d/19r4K1ZBiZLcjHXLbJfTjJ1C9AEOSi_KZ4DcZnmVTg5E/edit?usp=sharing)

## SCREENSHOT

**Index Page** - Page where users can write a post, get a list of posts, comments or activities from people who they follow. They can also react to the posts or comments. When they click to a certain post or comment, they will redirect to the ‘Post Detail View’ or ‘Comment Detail View’.

![Index View](https://user-images.githubusercontent.com/108860416/192294958-ab0172c8-0c3c-4874-90cb-7790e0d6a717.PNG)

&nbsp;

**Post Detail Page** - Page where users can see the details about the post. Users can see the comments that are related to the post below the post. Only the user itself can edit or delete the post. 

![Post Detail View](https://user-images.githubusercontent.com/108860416/192294966-217d0efc-054d-42dc-b55d-c9221e4547a5.PNG)
 
&nbsp;

**Comment Detail Page** - Page that displays the details for specific comments. Users can read the reply to the comments and same as post features, only the user itself can edit or delete the comment or reply.

![Comment View](https://user-images.githubusercontent.com/108860416/192294945-8928911c-e137-4d0a-ade0-8ee61c0381b9.PNG)

 &nbsp;

**Notification Page** - Page that shows all notification to the user.

![Notification View](https://user-images.githubusercontent.com/108860416/192294962-e0115e03-deb9-4431-966d-c320eafe336b.PNG)

 &nbsp;

**Post Edit Page** - Page where users can edit their own post. 

![Post Edit View](https://user-images.githubusercontent.com/108860416/192294969-0e645679-6e52-4f16-880e-4005cb323c99.PNG)

 &nbsp;

There are many other pages such as Bookmark Page, Post Delete Page, Comment Edit Page and others. Pages that are still under development are Search Page, Profile Page and Settings Page.

## STATUS

Not Completed. Ongoing development.

## WHAT IS NEXT?

- Complete the Search Page, Profile Page and Settings page.
- Add 'Attach Image' features.
- Develop REST API using Django Rest Framework.
- Improve UI/UX and develop using Vue.js.

## CONTACT 

Created by [Fidan Azhan](https://github.com/fidanazhan) - feel free to contact me!
